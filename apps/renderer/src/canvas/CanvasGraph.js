/**
 * CanvasGraph — Canvas-based force-directed graph renderer.
 *
 * Adapted from the original GraphRenderer with React lifecycle support.
 *
 * Performance optimizations for large graphs:
 *  - Grid-based spatial hashing for O(n) repulsion
 *  - Dirty-flag requestAnimationFrame (no infinite loop redraws)
 *  - Viewport culling: skip off-screen nodes/edges
 *  - Detail-level scaling: skip labels at low zoom
 *  - Node cap with sampling for huge datasets
 *  - Edge lookup via Map for O(1) access
 *  - Proper cleanup & resource release on destroy
 */

import {
  neptunePropsToMap,
  resolveId,
  isNeptuneEdge,
  isNeptuneVertex,
  escapeHtml,
  getDisplayLabel,
} from '../utils/helpers.js';

/** Maximum nodes before sampling */
const MAX_RENDER_NODES = 2000;
/** Maximum edges */
const MAX_RENDER_EDGES = 5000;
/** Grid cell size for spatial hashing */
const GRID_CELL_SIZE = 120;

const DPR = () => window.devicePixelRatio || 1;

export class CanvasGraph {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {Function} [options.onShowDynamoModal] - callback(id, graphItem)
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onShowDynamoModal = options.onShowDynamoModal || null;

    // Layout state
    this._width = 0;
    this._height = 0;
    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;

    // Node/edge data
    this._nodeArray = [];
    this._nodeMap = new Map();
    this._edgesList = [];
    this._baseRadius = 20;

    // Interaction
    this._dragging = false;
    this._dragNode = null;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._hoveredNode = null;
    this._hoveredEdge = null;
    this._pinnedItem = null;

    // Tooltip & detail panel (DOM elements managed externally via callbacks)
    this._tooltipEl = null;
    this._detailPanelEl = null;

    // Rendering
    this._dirty = true;
    this._rafId = null;
    this._destroyed = false;

    // Warning message for non-graph data
    this._dataWarning = null;

    this._bindEvents();
    this._resize();
    this._startRenderLoop();
  }

  // ===== Public API =====

  /**
   * Load and render graph data.
   * @param {any[]} data
   */
  async setData(data) {
    this._dataWarning = null;

    // Normalize: accept raw array or object with data/edges/results array (e.g. { data: [...] })
    const raw = data;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      data = raw.data ?? raw.edges ?? raw.results ?? raw.items ?? [];
    }
    if (!Array.isArray(data)) data = [];

    if (!data || data.length === 0) {
      this._nodeArray = [];
      this._nodeMap.clear();
      this._edgesList = [];
      this._dirty = true;
      return;
    }

    try {
      const { nodes, edges, warning } = this._extractGraphData(data);
      this._dataWarning = warning || null;

      if (nodes.size === 0) {
        this._nodeArray = [];
        this._nodeMap.clear();
        this._edgesList = [];
        this._dirty = true;
        return;
      }

      // Build layout arrays
      this._buildLayout(nodes, edges);
      this._simulate();
      this._autoFit();
      this._dirty = true;
    } catch (err) {
      console.error('[CanvasGraph] Error processing graph data:', err);
      this._nodeArray = [];
      this._nodeMap.clear();
      this._edgesList = [];
      this._dataWarning = `Error processing data: ${err.message}`;
      this._dirty = true;
    }
  }

  /**
   * Get graph info for the UI.
   */
  getInfo() {
    return {
      nodeCount: this._nodeArray.length,
      edgeCount: this._edgesList.length,
      hasData: this._nodeArray.length > 0,
    };
  }

  /**
   * Get pinned item (for detail panel rendering in React).
   * @returns {{ type: 'node'|'edge', data: object }|null}
   */
  getPinnedItem() {
    return this._pinnedItem;
  }

  /**
   * Get the current data warning (non-graph data message).
   * @returns {string|null}
   */
  getWarning() {
    return this._dataWarning;
  }

  autoFit() {
    this._autoFit();
    this._dirty = true;
  }

  zoomIn() {
    this._scale = Math.min(5, this._scale * 1.3);
    this._dirty = true;
  }

  zoomOut() {
    this._scale = Math.max(0.05, this._scale / 1.3);
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
    this._removeTooltip();
    this._nodeArray = [];
    this._nodeMap.clear();
    this._edgesList = [];
  }

  // ===== Graph Data Extraction =====

  _extractGraphData(data) {
    const nodes = new Map();
    const edges = [];
    const labelColors = {};
    const colorPalette = [
      '#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24',
      '#fb923c', '#2dd4bf', '#818cf8', '#e879f9', '#f87171',
    ];
    let colorIdx = 0;

    // Track what types of data we encountered for better error messages
    let stats = { total: 0, vertices: 0, edges: 0, paths: 0, maps: 0, primitives: 0, other: 0 };

    const getColorForLabel = (label) => {
      if (!labelColors[label]) {
        labelColors[label] = colorPalette[colorIdx % colorPalette.length];
        colorIdx++;
      }
      return labelColors[label];
    };

    // A label is considered "real" if it's not a generic placeholder
    const isRealLabel = (l) => l != null && l !== '' && l !== 'unknown' && l !== 'item';

    const addNode = (id, label, properties, rawProps) => {
      const nodeId = id != null ? String(id) : '';
      if (!nodeId) return;
      const propsMap = rawProps || neptunePropsToMap(properties);

      if (nodes.has(nodeId)) {
        const existing = nodes.get(nodeId);
        const existingPropCount = Object.keys(existing.properties).length;
        const newPropCount = Object.keys(propsMap).length;
        const hasMoreProps = newPropCount > existingPropCount;
        // Upgrade a placeholder label ("unknown"/"item") to a real one
        const upgradingLabel = isRealLabel(label) && !isRealLabel(existing.fullLabel);

        if (hasMoreProps || upgradingLabel) {
          if (hasMoreProps) Object.assign(existing.properties, propsMap);
          if (label != null) existing.fullLabel = label;
          existing.label = getDisplayLabel(existing.fullLabel, existing.properties, nodeId);
          existing.color = getColorForLabel(existing.fullLabel);
        }
        return;
      }

      const effectiveLabel = label ?? 'item';
      nodes.set(nodeId, {
        id: nodeId,
        label: getDisplayLabel(effectiveLabel, propsMap, nodeId),
        fullLabel: effectiveLabel,
        color: getColorForLabel(effectiveLabel),
        properties: propsMap,
      });
    };

    /**
     * Unwrap GraphSON v2/v3 wrapper format:
     * { "@type": "g:Vertex", "@value": { id: ..., label: ..., properties: ... } }
     */
    const unwrapGraphSON = (item) => {
      if (item && typeof item === 'object' && item['@type'] && item['@value'] !== undefined) {
        const type = item['@type'];
        const value = item['@value'];
        // Unwrap typed values (g:Int64, g:Double, etc.)
        if (typeof value !== 'object' || value === null) return value;
        // Recursively unwrap nested @value
        if (value['@type'] && value['@value'] !== undefined) return unwrapGraphSON(value);
        return value;
      }
      return item;
    };

    // Canonical edge shape: { from, to, label, id, properties, fromLabel, toLabel } — all strings except properties (object)
    const addEdge = (fromId, toId, label, edgeId, properties, fromLabel, toLabel) => {
      if (edges.length < MAX_RENDER_EDGES) {
        const from = fromId != null ? String(fromId) : '';
        const to = toId != null ? String(toId) : '';
        if (!from || !to) return;
        const edgeLabel = (label != null && label !== '') ? String(label) : '';
        edges.push({
          from,
          to,
          label: edgeLabel,
          id: edgeId != null ? String(edgeId) : `${from}-${to}-${edges.length}`,
          properties: properties && typeof properties === 'object' ? properties : {},
          fromLabel: fromLabel != null ? String(fromLabel) : 'unknown',
          toLabel: toLabel != null ? String(toLabel) : 'unknown',
        });
      }
    };

    /**
     * Unwrap TinkerPop object-format vertex/edge properties to a flat { key: value } map.
     * Format: { propKey: [{id, label/key, value}, ...] | {value} | scalar }
     */
    const unwrapPropsObject = (properties) => {
      if (!properties || typeof properties !== 'object') return {};
      const result = {};
      for (const [k, v] of Object.entries(properties)) {
        if (Array.isArray(v)) {
          const first = v[0];
          result[k] = (first && typeof first === 'object' && 'value' in first) ? first.value : first;
        } else if (v && typeof v === 'object' && 'value' in v) {
          result[k] = v.value;
        } else {
          result[k] = v;
        }
      }
      return result;
    };

    const extractItem = (item) => {
      if (item === null || item === undefined) return;

      // Primitives — not graphable
      if (typeof item !== 'object') {
        stats.primitives++;
        stats.total++;
        return;
      }

      // Arrays — recurse
      if (Array.isArray(item)) {
        item.forEach(extractItem);
        return;
      }

      stats.total++;

      // Unwrap GraphSON v2/v3 format
      item = unwrapGraphSON(item);
      if (typeof item !== 'object' || item === null) {
        stats.primitives++;
        return;
      }

      // Path objects: { labels: [...], objects: [...] }
      if (item.labels !== undefined && item.objects !== undefined) {
        stats.paths++;
        if (Array.isArray(item.objects)) item.objects.forEach(extractItem);
        return;
      }

      // Neptune edges: { outV, inV, label, id, properties } or flattened { outV, inV } as string ids
      // After _processResults: outV/inV are plain id strings; outVLabel/inVLabel carry the original labels.
      if (isNeptuneEdge(item)) {
        stats.edges++;
        const outV = unwrapGraphSON(item.outV);
        const inV  = unwrapGraphSON(item.inV);

        const fromId = (outV != null && typeof outV === 'object')
          ? String(outV.id ?? outV)
          : (outV != null ? String(outV).trim() : '');
        const toId = (inV != null && typeof inV === 'object')
          ? String(inV.id ?? inV)
          : (inV != null ? String(inV).trim() : '');
        if (!fromId || !toId) return;

        // Prefer outVLabel/inVLabel (preserved by _processResults from vertex refs)
        // then fall back to extracting from inline vertex objects (raw / path-nested edges)
        const fromLabel = item.outVLabel ||
          ((outV != null && typeof outV === 'object') ? (outV.label || 'unknown') : 'unknown');
        const toLabel = item.inVLabel ||
          ((inV != null && typeof inV === 'object') ? (inV.label || 'unknown') : 'unknown');

        // Inline vertex objects (path-nested) carry properties we can use immediately
        const fromProps = (outV != null && typeof outV === 'object') ? outV.properties : null;
        const toProps   = (inV  != null && typeof inV  === 'object') ? inV.properties  : null;
        addNode(fromId, fromLabel, fromProps || []);
        addNode(toId,   toLabel,   toProps   || []);

        // Edge properties: handle both object format and flattened format
        const edgeMeta = new Set(['id', 'label', 'type', 'outV', 'inV', 'outVLabel', 'inVLabel']);
        let edgeProps = {};
        if (item.properties && typeof item.properties === 'object') {
          edgeProps = unwrapPropsObject(item.properties);
        } else {
          for (const [k, v] of Object.entries(item)) {
            if (!edgeMeta.has(k)) edgeProps[k] = v;
          }
        }
        addEdge(fromId, toId, item.label ?? '', resolveId(item.id), edgeProps, fromLabel, toLabel);
        return;
      }

      // Neptune vertices: { id, label, properties } or flattened { id, label, prop1, prop2, ... }
      if (isNeptuneVertex(item)) {
        stats.vertices++;
        const nodeId   = String(item.id);
        const nodeLabel = item.label ?? 'item';

        if (Array.isArray(item.properties)) {
          // Pre-processed array format
          addNode(nodeId, nodeLabel, item.properties);
        } else if (item.properties && typeof item.properties === 'object') {
          // Object format: { propKey: [{id, label/key, value}, ...] | {value} | scalar }
          // This occurs for path-nested vertices that bypassed _processResults
          addNode(nodeId, nodeLabel, null, unwrapPropsObject(item.properties));
        } else {
          // Already flat: { id, label, name: "...", age: 30, ... }
          const props = {};
          const vertexMeta = new Set(['id', 'label', 'type']);
          for (const [k, v] of Object.entries(item)) {
            if (vertexMeta.has(k)) continue;
            if (Array.isArray(v) && v.length === 1) {
              props[k] = v[0];
            } else if (typeof v === 'object' && v !== null && v['@value'] !== undefined) {
              props[k] = unwrapGraphSON(v);
            } else {
              props[k] = v;
            }
          }
          addNode(nodeId, nodeLabel, null, props);
        }
        return;
      }

      // --- Extended format support ---

      // elementMap() results: { id: "...", label: "...", prop1: val1, ... }
      // Also handles objects with "T.id" / "T.label" keys from TinkerPop
      const tId = item['T.id'] ?? item['id'];
      const tLabel = item['T.label'] ?? item['label'];
      const tType = item['T.type'] ?? item['type'];

      // Check if this is an edge-like map (from elementMap on edges)
      // These have Direction.IN / Direction.OUT or inV/outV-like fields
      const dirIn = item['Direction.IN'] ?? item['IN'] ?? item['inV'];
      const dirOut = item['Direction.OUT'] ?? item['OUT'] ?? item['outV'];

      if (tId !== undefined && dirIn !== undefined && dirOut !== undefined) {
        // This is an edge from elementMap()
        stats.edges++;
        const fromRaw = unwrapGraphSON(dirOut);
        const toRaw = unwrapGraphSON(dirIn);
        const fromId = (fromRaw && typeof fromRaw === 'object') ? String(fromRaw.id || fromRaw) : String(fromRaw);
        const toId = (toRaw && typeof toRaw === 'object') ? String(toRaw.id || toRaw) : String(toRaw);
        const fromLabel = (fromRaw && typeof fromRaw === 'object') ? (fromRaw.label || 'unknown') : 'unknown';
        const toLabel = (toRaw && typeof toRaw === 'object') ? (toRaw.label || 'unknown') : 'unknown';

        addNode(fromId, fromLabel, []);
        addNode(toId, toLabel, []);

        // Collect non-meta properties
        const edgeProps = {};
        for (const [k, v] of Object.entries(item)) {
          if (['id', 'label', 'type', 'T.id', 'T.label', 'T.type',
               'Direction.IN', 'Direction.OUT', 'IN', 'OUT', 'inV', 'outV'].includes(k)) continue;
          edgeProps[k] = v;
        }
        addEdge(fromId, toId, tLabel || '', resolveId(tId), edgeProps, fromLabel, toLabel);
        return;
      }

      // Generic edge-like objects: { source/from, target/to }
      const sourceId = item.source ?? item.from ?? item.src;
      const targetId = item.target ?? item.to ?? item.dst;
      if (sourceId !== undefined && targetId !== undefined) {
        stats.edges++;
        const fromId = String(typeof sourceId === 'object' ? (sourceId.id || JSON.stringify(sourceId)) : sourceId);
        const toId = String(typeof targetId === 'object' ? (targetId.id || JSON.stringify(targetId)) : targetId);
        addNode(fromId, 'unknown', []);
        addNode(toId, 'unknown', []);
        const edgeProps = {};
        for (const [k, v] of Object.entries(item)) {
          if (['source', 'from', 'src', 'target', 'to', 'dst', 'id', 'label'].includes(k)) continue;
          edgeProps[k] = v;
        }
        addEdge(fromId, toId, item.label || item.type || '', resolveId(item.id), edgeProps, 'unknown', 'unknown');
        return;
      }

      // Vertex-like objects from elementMap() or valueMap():
      // Objects with an "id" field (but no outV/inV) → treat as vertex
      if (tId !== undefined) {
        stats.vertices++;
        const nodeId = String(tId);
        const nodeLabel = String(tLabel || tType || 'item');
        // Collect all non-meta keys as properties
        const props = {};
        for (const [k, v] of Object.entries(item)) {
          if (['id', 'label', 'type', 'T.id', 'T.label', 'T.type'].includes(k)) continue;
          // valueMap() wraps values in arrays: {name: ["John"]}
          if (Array.isArray(v) && v.length === 1) {
            props[k] = v[0];
          } else if (Array.isArray(v) && v.length > 0 && v.every(x => typeof x !== 'object')) {
            props[k] = v.join(', ');
          } else if (typeof v === 'object' && v !== null && v['@value'] !== undefined) {
            props[k] = unwrapGraphSON(v);
          } else {
            props[k] = v;
          }
        }
        addNode(nodeId, nodeLabel, null, props);
        return;
      }

      // Maps / objects without id — try to find nested graph elements
      // e.g., group().by() results: { "labelA": [{vertex}, ...], "labelB": [...] }
      let foundNested = false;
      for (const [key, value] of Object.entries(item)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
          const first = unwrapGraphSON(value[0]);
          if (first && (isNeptuneVertex(first) || isNeptuneEdge(first) || first.id !== undefined)) {
            value.forEach(extractItem);
            foundNested = true;
          }
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          const unwrapped = unwrapGraphSON(value);
          if (unwrapped && typeof unwrapped === 'object' && (isNeptuneVertex(unwrapped) || isNeptuneEdge(unwrapped))) {
            extractItem(unwrapped);
            foundNested = true;
          }
        }
      }

      if (!foundNested) {
        stats.maps++;
      }
    };

    data.forEach(extractItem);

    // If no nodes but we have data, try one more pass: unwrap GraphSON and re-check first item
    if (nodes.size === 0 && data.length > 0) {
      const firstRaw = data[0];
      const firstUnwrapped = unwrapGraphSON(firstRaw && typeof firstRaw === 'object' ? firstRaw : firstRaw);
      const keys = firstUnwrapped && typeof firstUnwrapped === 'object' ? Object.keys(firstUnwrapped) : [];
      const hasOutIn = firstUnwrapped && (firstUnwrapped.outV !== undefined && firstUnwrapped.inV !== undefined);
      console.warn(`[CanvasGraph] No nodes extracted. First item keys: [${keys.join(', ')}], hasOutV/inV: ${hasOutIn}. Unwrapped sample:`, firstUnwrapped && typeof firstUnwrapped === 'object' ? JSON.stringify(firstUnwrapped).slice(0, 300) : firstUnwrapped);
    }

    // Cap nodes
    if (nodes.size > MAX_RENDER_NODES) {
      const allKeys = Array.from(nodes.keys());
      const edgeNodeIds = new Set();
      edges.forEach(e => { edgeNodeIds.add(e.from); edgeNodeIds.add(e.to); });
      const keysToKeep = new Set();
      for (const key of allKeys) {
        if (keysToKeep.size >= MAX_RENDER_NODES) break;
        if (edgeNodeIds.has(key)) keysToKeep.add(key);
      }
      for (const key of allKeys) {
        if (keysToKeep.size >= MAX_RENDER_NODES) break;
        keysToKeep.add(key);
      }
      for (const key of allKeys) {
        if (!keysToKeep.has(key)) nodes.delete(key);
      }
      const validEdges = edges.filter(e => nodes.has(e.from) && nodes.has(e.to));
      edges.length = 0;
      edges.push(...validEdges);
    }

    // Build a helpful warning message if no graph data was extracted
    let warning = null;
    if (nodes.size === 0 && stats.total > 0) {
      const parts = [];
      if (stats.primitives > 0) parts.push(`${stats.primitives} primitive value${stats.primitives > 1 ? 's' : ''}`);
      if (stats.maps > 0) parts.push(`${stats.maps} map/object${stats.maps > 1 ? 's' : ''}`);
      if (stats.paths > 0) parts.push(`${stats.paths} path${stats.paths > 1 ? 's' : ''}`);
      if (stats.other > 0) parts.push(`${stats.other} other item${stats.other > 1 ? 's' : ''}`);

      warning = `Found ${stats.total} result${stats.total > 1 ? 's' : ''} (${parts.join(', ')}), but none contain graph structure (vertices/edges).`;
    }

    return { nodes, edges, warning };
  }

  // ===== Layout & Simulation =====

  _buildLayout(nodesMap, edgesList) {
    this._nodeArray = [];
    this._nodeMap.clear();
    this._edgesList = edgesList;

    const nodeCount = nodesMap.size;
    this._baseRadius = nodeCount > 200 ? 12 : nodeCount > 50 ? 16 : nodeCount > 20 ? 20 : 24;

    let idx = 0;
    nodesMap.forEach((node) => {
      const angle = (2 * Math.PI * idx) / nodesMap.size;
      const layoutRadius = Math.min(600, Math.max(100, nodesMap.size * 15));
      const n = {
        ...node,
        x: Math.cos(angle) * layoutRadius + (Math.random() - 0.5) * 30,
        y: Math.sin(angle) * layoutRadius + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        radius: this._baseRadius,
      };
      this._nodeArray.push(n);
      this._nodeMap.set(n.id, n);
      idx++;
    });
  }

  _simulate() {
    const len = this._nodeArray.length;
    const iterations = len > 500 ? 30 : len > 200 ? 60 : len > 50 ? 100 : Math.min(200, Math.max(50, 300 - len));
    const repulsionStrength = len > 200 ? 12000 : len > 50 ? 8000 : 5000;
    const springLength = len > 200 ? 250 : len > 50 ? 200 : 150;

    for (let iter = 0; iter < iterations; iter++) {
      // Grid-based spatial hashing
      const grid = new Map();
      for (let i = 0; i < len; i++) {
        const n = this._nodeArray[i];
        const key = `${Math.floor(n.x / GRID_CELL_SIZE)},${Math.floor(n.y / GRID_CELL_SIZE)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(n);
      }

      for (let i = 0; i < len; i++) {
        const a = this._nodeArray[i];
        const cellX = Math.floor(a.x / GRID_CELL_SIZE);
        const cellY = Math.floor(a.y / GRID_CELL_SIZE);

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cell = grid.get(`${cellX + dx},${cellY + dy}`);
            if (!cell) continue;
            for (let j = 0; j < cell.length; j++) {
              const b = cell[j];
              if (b === a) continue;
              const ddx = b.x - a.x;
              const ddy = b.y - a.y;
              const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 1);
              const force = repulsionStrength / (dist * dist);
              a.vx -= (ddx / dist) * force * 0.5;
              a.vy -= (ddy / dist) * force * 0.5;
            }
          }
        }
      }

      // Spring forces (edge shape: { from, to, label, id, properties, fromLabel, toLabel })
      for (let i = 0; i < this._edgesList.length; i++) {
        const edge = this._edgesList[i];
        const fromKey = edge.from != null ? String(edge.from) : '';
        const toKey = edge.to != null ? String(edge.to) : '';
        const from = fromKey ? this._nodeMap.get(fromKey) : null;
        const to = toKey ? this._nodeMap.get(toKey) : null;
        if (from && to) {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (dist - springLength) * 0.01;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          from.vx += fx; from.vy += fy;
          to.vx -= fx; to.vy -= fy;
        }
      }

      // Gravity + damping
      const damping = 0.8;
      for (let i = 0; i < len; i++) {
        const node = this._nodeArray[i];
        node.vx -= node.x * 0.002;
        node.vy -= node.y * 0.002;
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
      }
    }
  }

  _autoFit() {
    if (this._nodeArray.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of this._nodeArray) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const graphW = maxX - minX + 100;
    const graphH = maxY - minY + 100;
    this._scale = Math.max(0.1, Math.min(2, Math.min(
      (this._width - 80) / graphW,
      (this._height - 80) / graphH
    )));
    this._offsetX = 0;
    this._offsetY = 0;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    for (const n of this._nodeArray) { n.x -= cx; n.y -= cy; }
    this._dirty = true;
  }

  // ===== Events =====

  _bindEvents() {
    this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
    this.canvas.addEventListener('click', this._onClick.bind(this));
    this.canvas.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this.canvas.addEventListener('mouseleave', this._onMouseLeave.bind(this));

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
  }

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
    this._dirty = true;
  }

  _getNodeAt(mx, my) {
    const cx = (mx - this._width / 2 - this._offsetX) / this._scale;
    const cy = (my - this._height / 2 - this._offsetY) / this._scale;
    for (let i = this._nodeArray.length - 1; i >= 0; i--) {
      const n = this._nodeArray[i];
      const dx = cx - n.x, dy = cy - n.y;
      if (dx * dx + dy * dy <= (n.radius + 4) ** 2) return n;
    }
    return null;
  }

  _getEdgeAt(mx, my) {
    const cx = (mx - this._width / 2 - this._offsetX) / this._scale;
    const cy = (my - this._height / 2 - this._offsetY) / this._scale;
    const threshold = Math.max(6, 8 / this._scale);
    for (let i = this._edgesList.length - 1; i >= 0; i--) {
      const edge = this._edgesList[i];
      const fromKey = edge.from != null ? String(edge.from) : '';
      const toKey = edge.to != null ? String(edge.to) : '';
      const from = fromKey ? this._nodeMap.get(fromKey) : null;
      const to = toKey ? this._nodeMap.get(toKey) : null;
      if (!from || !to) continue;
      const abx = to.x - from.x, aby = to.y - from.y;
      const acx = cx - from.x, acy = cy - from.y;
      const abLen2 = abx * abx + aby * aby;
      if (abLen2 === 0) continue;
      let t = Math.max(0, Math.min(1, (acx * abx + acy * aby) / abLen2));
      const px = from.x + t * abx, py = from.y + t * aby;
      const ddx = cx - px, ddy = cy - py;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < threshold) return edge;
    }
    return null;
  }

  _onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const node = this._getNodeAt(mx, my);
    if (node) {
      this._dragNode = node;
      this._dragStartX = mx;
      this._dragStartY = my;
    } else {
      this._dragging = true;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;
    }
  }

  _onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    if (this._dragNode) {
      this._dragNode.x += (mx - this._dragStartX) / this._scale;
      this._dragNode.y += (my - this._dragStartY) / this._scale;
      this._dragStartX = mx;
      this._dragStartY = my;
      this._dirty = true;
    } else if (this._dragging) {
      this._offsetX += e.clientX - this._dragStartX;
      this._offsetY += e.clientY - this._dragStartY;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;
      this._dirty = true;
    } else {
      const prevNode = this._hoveredNode;
      const prevEdge = this._hoveredEdge;
      this._hoveredNode = this._getNodeAt(mx, my);
      this._hoveredEdge = this._hoveredNode ? null : this._getEdgeAt(mx, my);
      this.canvas.style.cursor = (this._hoveredNode || this._hoveredEdge) ? 'pointer' : 'default';
      if (this._hoveredNode !== prevNode || this._hoveredEdge !== prevEdge) {
        this._dirty = true;
      }
      // Update tooltip
      this._updateTooltip(e, this._hoveredNode, this._hoveredEdge);
    }
  }

  _onMouseUp() {
    this._dragNode = null;
    this._dragging = false;
  }

  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const node = this._getNodeAt(mx, my);
    if (node) {
      this._pinnedItem = { type: 'node', data: node };
      this._removeTooltip();
      this._dirty = true;
      return;
    }
    const edge = this._getEdgeAt(mx, my);
    if (edge) {
      this._pinnedItem = { type: 'edge', data: edge };
      this._removeTooltip();
      this._dirty = true;
      return;
    }
    if (this._pinnedItem) {
      this._pinnedItem = null;
      this._dirty = true;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this._scale = Math.max(0.05, Math.min(5, this._scale * factor));
    this._dirty = true;
  }

  _onMouseLeave() {
    this._removeTooltip();
  }

  // ===== Tooltip (DOM-based for rich content) =====

  _updateTooltip(e, node, edge) {
    if (this._pinnedItem) {
      this._removeTooltip();
      return;
    }

    if (!node && !edge) {
      this._removeTooltip();
      return;
    }

    if (!this._tooltipEl) {
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.className = 'node-tooltip';
      document.body.appendChild(this._tooltipEl);
    }

    let html = '';
    if (node) {
      html = `<h4>${escapeHtml(node.fullLabel)}</h4>`;
      html += `<div class="tooltip-row"><span class="tooltip-key">ID</span><span class="tooltip-value">${escapeHtml(node.id)}</span></div>`;
      const props = node.properties;
      if (props && typeof props === 'object') {
        for (const [key, val] of Object.entries(props)) {
          const display = (val == null) ? '—' : String(val);
          html += `<div class="tooltip-row"><span class="tooltip-key">${escapeHtml(key)}</span><span class="tooltip-value">${escapeHtml(display)}</span></div>`;
        }
      }
      html += `<div class="tooltip-hint">Click to see full details</div>`;
    } else if (edge) {
      const edgeLabel = (edge.label != null && edge.label !== '') ? String(edge.label) : 'Edge';
      const fromL = (edge.fromLabel != null) ? String(edge.fromLabel) : '';
      const toL = (edge.toLabel != null) ? String(edge.toLabel) : '';
      html = `<h4>${escapeHtml(edgeLabel)}</h4>`;
      html += `<div class="tooltip-row"><span class="tooltip-key">From</span><span class="tooltip-value">${escapeHtml(fromL)} → ${escapeHtml(toL)}</span></div>`;
      const props = edge.properties && typeof edge.properties === 'object' ? edge.properties : {};
      for (const [key, val] of Object.entries(props)) {
        html += `<div class="tooltip-row"><span class="tooltip-key">${escapeHtml(key)}</span><span class="tooltip-value">${escapeHtml(val == null ? '—' : String(val))}</span></div>`;
      }
      html += `<div class="tooltip-hint">Click to see full details</div>`;
    }

    this._tooltipEl.innerHTML = html;
    this._tooltipEl.style.display = 'block';
    this._tooltipEl.style.left = (e.clientX + 16) + 'px';
    this._tooltipEl.style.top = (e.clientY + 16) + 'px';
  }

  _removeTooltip() {
    if (this._tooltipEl) {
      this._tooltipEl.style.display = 'none';
    }
  }

  // ===== Rendering =====

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

  _isInViewport(x, y, margin) {
    const sx = x * this._scale + this._width / 2 + this._offsetX;
    const sy = y * this._scale + this._height / 2 + this._offsetY;
    return sx >= -margin && sx <= this._width + margin && sy >= -margin && sy <= this._height + margin;
  }

  _render() {
    const { ctx, _width: w, _height: h, _scale: scale } = this;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + this._offsetX, h / 2 + this._offsetY);
    ctx.scale(scale, scale);

    const viewMargin = this._baseRadius * 3;
    const nodeCount = this._nodeArray.length;
    const showLabels = scale > 0.3 || nodeCount < 30;
    const showEdgeLabels = scale > 0.5 && this._edgesList.length < 500;

    // Draw edges (expect shape: { from, to, label, id, properties, fromLabel, toLabel })
    for (const edge of this._edgesList) {
      const fromKey = edge.from != null ? String(edge.from) : '';
      const toKey = edge.to != null ? String(edge.to) : '';
      const from = fromKey ? this._nodeMap.get(fromKey) : null;
      const to = toKey ? this._nodeMap.get(toKey) : null;
      if (!from || !to) continue;
      if (!this._isInViewport(from.x, from.y, viewMargin) && !this._isInViewport(to.x, to.y, viewMargin)) continue;

      const isHighlighted = this._hoveredEdge === edge ||
        (this._pinnedItem?.type === 'edge' && this._pinnedItem.data === edge);

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = isHighlighted ? '#a78bfa' : 'rgba(100, 116, 139, 0.4)';
      ctx.lineWidth = isHighlighted ? 2.5 : 1.2;
      ctx.stroke();

      // Arrow
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const arrowDist = to.radius + 4;
      const ax = to.x - Math.cos(angle) * arrowDist;
      const ay = to.y - Math.sin(angle) * arrowDist;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 8 * Math.cos(angle - 0.3), ay - 8 * Math.sin(angle - 0.3));
      ctx.lineTo(ax - 8 * Math.cos(angle + 0.3), ay - 8 * Math.sin(angle + 0.3));
      ctx.closePath();
      ctx.fillStyle = isHighlighted ? '#a78bfa' : 'rgba(100, 116, 139, 0.6)';
      ctx.fill();

      const edgeLabelText = (edge.label != null && edge.label !== '') ? String(edge.label) : '';
      if (showEdgeLabels && edgeLabelText) {
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        ctx.font = `${Math.max(8, 10 / scale * 0.8)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textW = ctx.measureText(edgeLabelText).width;
        ctx.fillStyle = isHighlighted ? 'rgba(167, 139, 250, 0.3)' : 'rgba(15, 23, 42, 0.8)';
        ctx.fillRect(mx - textW / 2 - 3, my - 8, textW + 6, 14);
        ctx.fillStyle = isHighlighted ? '#e2d9ff' : '#94a3b8';
        ctx.fillText(edgeLabelText, mx, my - 1);
      }
    }

    // Draw nodes
    for (const node of this._nodeArray) {
      if (!this._isInViewport(node.x, node.y, viewMargin)) continue;

      const isHovered = this._hoveredNode === node;
      const r = isHovered ? node.radius + 3 : node.radius;

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = node.color + '33';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);

      if (nodeCount > 300) {
        ctx.fillStyle = node.color + 'cc';
      } else {
        const grad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
        grad.addColorStop(0, node.color + 'ee');
        grad.addColorStop(1, node.color + '99');
        ctx.fillStyle = grad;
      }
      ctx.fill();
      ctx.strokeStyle = isHovered ? '#ffffff' : node.color;
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.stroke();

      if (showLabels) {
        ctx.font = `bold 11px Inter, sans-serif`;
        ctx.fillStyle = '#f1f5f9';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = node.label.split('\n');
        for (let li = 0; li < lines.length; li++) {
          const ly = node.y + (li - (lines.length - 1) / 2) * 13;
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
          ctx.lineWidth = 3;
          ctx.strokeText(lines[li], node.x, ly);
          ctx.fillText(lines[li], node.x, ly);
        }
      }
    }

    ctx.restore();

    // Empty state — show informative messages
    if (this._nodeArray.length === 0) {
      this._drawEmptyState(ctx, w, h);
    }
  }

  _drawEmptyState(ctx, w, h) {
    const cx = w / 2;
    let y = h / 2 - 50;

    // Icon (simple graph icon drawn on canvas)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#334155';

    // Draw small graph icon
    const iconY = y - 20;
    const r = 6;
    const positions = [
      [cx - 20, iconY - 10], [cx + 20, iconY - 10],
      [cx, iconY + 15],
    ];
    // Edges
    ctx.beginPath();
    ctx.moveTo(positions[0][0], positions[0][1]);
    ctx.lineTo(positions[1][0], positions[1][1]);
    ctx.lineTo(positions[2][0], positions[2][1]);
    ctx.lineTo(positions[0][0], positions[0][1]);
    ctx.strokeStyle = '#334155';
    ctx.stroke();
    // Nodes
    for (const [px, py] of positions) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.stroke();
    }

    y += 20;

    if (this._dataWarning) {
      // Data exists but isn't graph-renderable
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '600 15px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Cannot render as graph', cx, y);
      y += 28;

      // Show the warning (may need word wrapping)
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Inter, sans-serif';
      const warnLines = this._wrapText(ctx, this._dataWarning, w - 80);
      for (const line of warnLines) {
        ctx.fillText(line, cx, y);
        y += 18;
      }
      y += 12;

      // Suggestion
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Use the Table or JSON tab to view this data, or try:', cx, y);
      y += 24;

      // Example queries
      ctx.fillStyle = '#38bdf8';
      ctx.font = '500 12px "JetBrains Mono", monospace';
      const examples = [
        'g.V().limit(50)',
        'g.V().outE().limit(50)',
        'g.V().bothE().limit(50)',
        'g.V().out().path().limit(20)',
      ];
      for (const ex of examples) {
        ctx.fillText(ex, cx, y);
        y += 20;
      }
    } else {
      // No data at all
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No graph data to display', cx, y);
      y += 22;
      ctx.font = '12px Inter, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText('Run a query that returns vertices or edges', cx, y);
    }
  }

  /**
   * Simple word-wrap helper for canvas text.
   */
  _wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
}

