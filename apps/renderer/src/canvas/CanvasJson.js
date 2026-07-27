/**
 * CanvasJson — Canvas-based JSON renderer with syntax highlighting.
 *
 * Renders JSON data directly onto a <canvas> element:
 *  - Tokenizes JSON into colored line segments
 *  - Virtual line rendering — only paints visible lines
 *  - Smooth scrolling
 *  - Truncation for extremely large payloads (configurable cap)
 *  - Dirty-flag rendering for 60fps
 *
 * Handles 100K+ lines of JSON without freezing.
 */

const DPR = () => window.devicePixelRatio || 1;

/** Maximum characters to tokenize (prevent freezing on huge payloads) */
const MAX_JSON_CHARS = 1_000_000;
/** Maximum items before summarizing */
const MAX_ITEMS_FULL = 10_000;

/** Token types with associated colors (dark theme) */
const TOKEN_COLORS = {
  key: '#38bdf8',       // accent
  string: '#34d399',    // success/green
  number: '#fb923c',    // orange
  boolean: '#a78bfa',   // purple
  null: '#64748b',      // muted
  brace: '#94a3b8',     // secondary
  punctuation: '#94a3b8',
  text: '#f1f5f9',      // primary
  truncated: '#fbbf24', // warning/yellow
};

export class CanvasJson {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.lineHeight = options.lineHeight || 20;
    this.fontSize = options.fontSize || 12;
    this.fontFamily = options.fontFamily || "'JetBrains Mono', 'Fira Code', monospace";
    this.paddingX = options.paddingX || 20;
    this.paddingY = options.paddingY || 16;

    this.bgColor = options.bgColor || '#0f172a';
    this.lineNumberColor = options.lineNumberColor || '#475569';
    this.lineNumberWidth = 50;

    // Data
    /** @type {Array<Array<{text: string, color: string}>>} */
    this._lines = [];
    this._truncated = false;
    this._totalItems = 0;

    // Viewport
    this._width = 0;
    this._height = 0;
    this._scrollY = 0;
    this._maxScrollY = 0;

    // Rendering
    this._dirty = true;
    this._rafId = null;
    this._destroyed = false;

    this._bindEvents();
    this._resize();
    this._startRenderLoop();
  }

  // ===== Public API =====

  /**
   * Set JSON data to render.
   * @param {any} data
   */
  setData(data) {
    this._scrollY = 0;
    this._tokenize(data);
    this._updateScrollBounds();
    this._dirty = true;
  }

  resize() {
    this._resize();
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._lines = [];
  }

  // ===== Internal: Events =====

  _bindEvents() {
    this._onWheel = (e) => {
      e.preventDefault();
      this._scrollY = Math.max(0, Math.min(this._maxScrollY, this._scrollY + e.deltaY));
      this._dirty = true;
    };
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
  }

  // ===== Internal: Layout =====

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;

    const dpr = DPR();
    this.canvas.width = this._width * dpr;
    this.canvas.height = this._height * dpr;
    this.canvas.style.width = this._width + 'px';
    this.canvas.style.height = this._height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._updateScrollBounds();
    this._dirty = true;
  }

  _updateScrollBounds() {
    const totalHeight = this._lines.length * this.lineHeight + this.paddingY * 2;
    this._maxScrollY = Math.max(0, totalHeight - this._height);
    this._scrollY = Math.min(this._scrollY, this._maxScrollY);
  }

  // ===== Internal: Tokenization =====

  /**
   * Convert data to an array of colored line segments.
   * Each line is an array of {text, color} objects.
   */
  _tokenize(data) {
    this._lines = [];
    this._truncated = false;
    this._totalItems = Array.isArray(data) ? data.length : 0;

    if (!data || (Array.isArray(data) && data.length === 0)) {
      this._lines = [[{ text: '[]', color: TOKEN_COLORS.brace }]];
      return;
    }

    let jsonStr;

    if (Array.isArray(data) && data.length > MAX_ITEMS_FULL) {
      const slice = data.slice(0, MAX_ITEMS_FULL);
      jsonStr = JSON.stringify(slice, null, 2);
      this._truncated = true;
    } else {
      jsonStr = JSON.stringify(data, null, 2);
    }

    if (jsonStr.length > MAX_JSON_CHARS) {
      jsonStr = jsonStr.substring(0, MAX_JSON_CHARS);
      this._truncated = true;
    }

    // Split into lines and tokenize each
    const rawLines = jsonStr.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
      this._lines.push(this._tokenizeLine(rawLines[i]));
    }

    // Add truncation notice
    if (this._truncated) {
      this._lines.push([]);
      this._lines.push([{
        text: `⚠ Output truncated — showing first ${MAX_ITEMS_FULL.toLocaleString()} of ${this._totalItems.toLocaleString()} items`,
        color: TOKEN_COLORS.truncated,
      }]);
    }
  }

  /**
   * Tokenize a single line into colored segments.
   * @param {string} line
   * @returns {Array<{text: string, color: string}>}
   */
  _tokenizeLine(line) {
    const segments = [];
    let remaining = line;

    // Leading whitespace
    const indentMatch = remaining.match(/^(\s+)/);
    if (indentMatch) {
      segments.push({ text: indentMatch[1], color: TOKEN_COLORS.text });
      remaining = remaining.substring(indentMatch[1].length);
    }

    while (remaining.length > 0) {
      // Key: "key":
      const keyMatch = remaining.match(/^"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/);
      if (keyMatch) {
        segments.push({ text: `"${keyMatch[1]}"`, color: TOKEN_COLORS.key });
        segments.push({ text: ': ', color: TOKEN_COLORS.punctuation });
        remaining = remaining.substring(keyMatch[0].length);
        // Trim space after colon
        const space = remaining.match(/^\s+/);
        if (space) {
          remaining = remaining.substring(space[0].length);
          if (!segments[segments.length - 1].text.endsWith(' ')) {
            segments[segments.length - 1].text += ' ';
          }
        }
        continue;
      }

      // String value: "..."
      const strMatch = remaining.match(/^"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (strMatch) {
        segments.push({ text: `"${strMatch[1]}"`, color: TOKEN_COLORS.string });
        remaining = remaining.substring(strMatch[0].length);
        continue;
      }

      // Number
      const numMatch = remaining.match(/^-?\d+\.?\d*([eE][+-]?\d+)?/);
      if (numMatch) {
        segments.push({ text: numMatch[0], color: TOKEN_COLORS.number });
        remaining = remaining.substring(numMatch[0].length);
        continue;
      }

      // Boolean
      const boolMatch = remaining.match(/^(true|false)/);
      if (boolMatch) {
        segments.push({ text: boolMatch[0], color: TOKEN_COLORS.boolean });
        remaining = remaining.substring(boolMatch[0].length);
        continue;
      }

      // Null
      const nullMatch = remaining.match(/^null/);
      if (nullMatch) {
        segments.push({ text: 'null', color: TOKEN_COLORS.null });
        remaining = remaining.substring(4);
        continue;
      }

      // Braces, brackets
      const braceMatch = remaining.match(/^[{}\[\]]/);
      if (braceMatch) {
        segments.push({ text: braceMatch[0], color: TOKEN_COLORS.brace });
        remaining = remaining.substring(1);
        continue;
      }

      // Punctuation (commas, etc.)
      const punctMatch = remaining.match(/^[,:]/);
      if (punctMatch) {
        segments.push({ text: punctMatch[0], color: TOKEN_COLORS.punctuation });
        remaining = remaining.substring(1);
        continue;
      }

      // Whitespace
      const wsMatch = remaining.match(/^\s+/);
      if (wsMatch) {
        segments.push({ text: wsMatch[0], color: TOKEN_COLORS.text });
        remaining = remaining.substring(wsMatch[0].length);
        continue;
      }

      // Fallback: consume one char
      segments.push({ text: remaining[0], color: TOKEN_COLORS.text });
      remaining = remaining.substring(1);
    }

    return segments;
  }

  // ===== Internal: Rendering =====

  _startRenderLoop() {
    const loop = () => {
      if (this._destroyed) return;
      if (this._dirty) {
        this._dirty = false;
        this._render();
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _render() {
    const { ctx, _width: w, _height: h } = this;

    // Clear
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, w, h);

    if (this._lines.length === 0) return;

    ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = 'top';

    // Determine visible line range
    const startLine = Math.max(0, Math.floor(this._scrollY / this.lineHeight));
    const endLine = Math.min(
      this._lines.length,
      Math.ceil((this._scrollY + h) / this.lineHeight) + 1
    );

    const lineNumDigits = String(this._lines.length).length;

    for (let i = startLine; i < endLine; i++) {
      const y = this.paddingY + i * this.lineHeight - this._scrollY;

      // Line number
      ctx.fillStyle = this.lineNumberColor;
      ctx.textAlign = 'right';
      ctx.fillText(
        String(i + 1).padStart(lineNumDigits, ' '),
        this.lineNumberWidth - 8,
        y
      );

      // Line segments
      ctx.textAlign = 'left';
      let x = this.lineNumberWidth + this.paddingX;
      const segments = this._lines[i];
      for (let s = 0; s < segments.length; s++) {
        ctx.fillStyle = segments[s].color;
        ctx.fillText(segments[s].text, x, y);
        x += ctx.measureText(segments[s].text).width;
      }
    }

    // Scrollbar
    this._drawScrollbar();
  }

  _drawScrollbar() {
    const totalHeight = this._lines.length * this.lineHeight + this.paddingY * 2;
    if (totalHeight <= this._height) return;

    const { ctx, _width: w, _height: h } = this;
    const barW = 6;
    const x = w - barW - 2;
    const trackH = h - 4;

    ctx.fillStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.beginPath();
    ctx.roundRect(x, 2, barW, trackH, 3);
    ctx.fill();

    const thumbH = Math.max(20, (h / totalHeight) * trackH);
    const thumbY = 2 + (this._scrollY / this._maxScrollY) * (trackH - thumbH);

    ctx.fillStyle = 'rgba(100, 116, 139, 0.6)';
    ctx.beginPath();
    ctx.roundRect(x, thumbY, barW, thumbH, 3);
    ctx.fill();
  }
}

