/**
 * DataStore — Memory-optimized data management for large query results.
 *
 * Key optimizations:
 *  - Holds a single reference to raw data (no duplication)
 *  - Lazy column extraction (computed once on first access)
 *  - Windowed access via getSlice() for virtual rendering
 *  - Explicit release via clear() to free memory immediately
 *  - Memory estimation for UI feedback
 *  - Neptune-specific parsing cached per dataset
 */

import {
  neptunePropsToMap,
  resolveId,
  isNeptuneEdge,
  isNeptuneVertex,
} from '../utils/helpers.js';

/** Maximum number of items to keep fully in memory */
const MAX_ITEMS = 500_000;

export class DataStore {
  constructor() {
    /** @type {any[]|null} Raw query result data */
    this._data = null;
    /** @type {string[]|null} Cached column names */
    this._columns = null;
    /** @type {Map<number, object>|null} Cached parsed rows (index → flat row) */
    this._rowCache = null;
    /** @type {number} Maximum rows to cache parsed results for */
    this._rowCacheLimit = 5000;
    /** @type {object|null} Cached dataset stats */
    this._stats = null;
    /** @type {string|null} Data type: 'simple' | 'neptune' | 'generic' */
    this._dataType = null;
    /** @type {boolean} Whether data contains edges */
    this._hasEdges = false;
  }

  // ===== Public API =====

  /**
   * Set new data, releasing any previous data.
   * @param {any[]} data — Raw query result array
   */
  setData(data) {
    this.clear();

    if (!data || !Array.isArray(data)) {
      this._data = [];
      return;
    }

    // Cap to prevent extreme memory usage
    if (data.length > MAX_ITEMS) {
      console.warn(`[DataStore] Data has ${data.length} items, capping at ${MAX_ITEMS}`);
      this._data = data.slice(0, MAX_ITEMS);
    } else {
      this._data = data;
    }

    // Pre-analyze data type (cheap operation)
    this._analyzeDataType();
  }

  /**
   * Get the full data array (reference, not copy).
   * @returns {any[]}
   */
  getData() {
    return this._data || [];
  }

  /**
   * Get a slice of data for virtual rendering.
   * @param {number} start — Start index (inclusive)
   * @param {number} end — End index (exclusive)
   * @returns {any[]}
   */
  getSlice(start, end) {
    if (!this._data) return [];
    return this._data.slice(
      Math.max(0, start),
      Math.min(end, this._data.length)
    );
  }

  /**
   * Get a single parsed row (flat object with string values).
   * Uses cache for repeated access.
   * @param {number} index
   * @returns {object|null}
   */
  getParsedRow(index) {
    if (!this._data || index < 0 || index >= this._data.length) return null;

    if (!this._rowCache) this._rowCache = new Map();

    if (this._rowCache.has(index)) return this._rowCache.get(index);

    const parsed = this._parseRow(this._data[index], index);

    // Only cache up to the limit to prevent memory blowup
    if (this._rowCache.size < this._rowCacheLimit) {
      this._rowCache.set(index, parsed);
    }

    return parsed;
  }

  /**
   * Get column definitions (computed lazily).
   * @returns {Array<{key: string, label: string, type: string}>}
   */
  getColumns() {
    if (this._columns) return this._columns;
    this._columns = this._extractColumns();
    return this._columns;
  }

  /**
   * Get dataset info.
   * @returns {{ count: number, dataType: string, hasEdges: boolean, memoryEstimate: number }}
   */
  getStats() {
    if (this._stats) return this._stats;
    this._stats = {
      count: this._data?.length ?? 0,
      dataType: this._dataType || 'unknown',
      hasEdges: this._hasEdges,
      memoryEstimate: this._estimateMemory(),
    };
    return this._stats;
  }

  /**
   * Get total row count.
   * @returns {number}
   */
  getCount() {
    return this._data?.length ?? 0;
  }

  /**
   * Get the data type.
   * @returns {string}
   */
  getDataType() {
    return this._dataType || 'unknown';
  }

  /**
   * Whether data has edges.
   * @returns {boolean}
   */
  hasEdges() {
    return this._hasEdges;
  }

  /**
   * Release all data and caches.
   */
  clear() {
    this._data = null;
    this._columns = null;
    this._stats = null;
    this._dataType = null;
    this._hasEdges = false;
    if (this._rowCache) {
      this._rowCache.clear();
      this._rowCache = null;
    }
  }

  // ===== Internal =====

  /**
   * Analyze data to determine type (simple, neptune, generic).
   */
  _analyzeDataType() {
    if (!this._data || this._data.length === 0) {
      this._dataType = 'empty';
      return;
    }

    // Check if all items are primitives
    const isSimple = this._data.every(
      item => typeof item !== 'object' || item === null
    );
    if (isSimple) {
      this._dataType = 'simple';
      return;
    }

    // Check for Neptune vertices/edges
    let hasEdge = false;
    let hasVertex = false;
    const sampleSize = Math.min(this._data.length, 50);
    for (let i = 0; i < sampleSize; i++) {
      if (isNeptuneEdge(this._data[i])) hasEdge = true;
      if (isNeptuneVertex(this._data[i])) hasVertex = true;
    }

    if (hasEdge || hasVertex) {
      this._dataType = 'neptune';
      this._hasEdges = hasEdge;
      return;
    }

    this._dataType = 'generic';
  }

  /**
   * Extract column definitions from data.
   * @returns {Array<{key: string, label: string, type: string}>}
   */
  _extractColumns() {
    if (!this._data || this._data.length === 0) return [];

    if (this._dataType === 'simple') {
      return [
        { key: '_index', label: '#', type: 'index' },
        { key: '_value', label: 'Value', type: 'value' },
      ];
    }

    if (this._dataType === 'neptune') {
      const propKeys = new Set();
      const sampleSize = Math.min(this._data.length, 200);
      for (let i = 0; i < sampleSize; i++) {
        const item = this._data[i];
        if (!item || typeof item !== 'object') continue;
        const propsMap = neptunePropsToMap(item.properties);
        for (const key of Object.keys(propsMap)) {
          propKeys.add(key);
        }
      }

      const cols = [
        { key: '_index', label: '#', type: 'index' },
        { key: '_id', label: 'ID', type: 'id' },
        { key: '_label', label: 'Label', type: 'label' },
      ];

      if (this._hasEdges) {
        cols.push(
          { key: '_outV', label: 'From (outV)', type: 'string' },
          { key: '_inV', label: 'To (inV)', type: 'string' },
        );
      }

      for (const key of propKeys) {
        cols.push({ key, label: key, type: 'property' });
      }

      return cols;
    }

    // Generic objects
    const colKeys = new Set();
    const sampleSize = Math.min(this._data.length, 200);
    for (let i = 0; i < sampleSize; i++) {
      if (this._data[i] && typeof this._data[i] === 'object') {
        for (const key of Object.keys(this._data[i])) {
          colKeys.add(key);
        }
      }
    }

    const cols = [{ key: '_index', label: '#', type: 'index' }];
    for (const key of colKeys) {
      cols.push({ key, label: key, type: 'generic' });
    }
    return cols;
  }

  /**
   * Parse a single row into a flat object keyed by column key.
   * @param {*} item — Raw data item
   * @param {number} index — Row index
   * @returns {object}
   */
  _parseRow(item, index) {
    const row = { _index: index + 1 };

    if (this._dataType === 'simple') {
      row._value = item === null || item === undefined ? '' : String(item);
      row._valueType = typeof item;
      return row;
    }

    if (this._dataType === 'neptune') {
      if (!item || typeof item !== 'object') {
        row._id = '';
        row._label = '';
        row._raw = String(item);
        return row;
      }

      const propsMap = neptunePropsToMap(item.properties);
      row._id = resolveId(item.id);
      row._label = item.label || '';

      if (this._hasEdges) {
        const outV = item.outV;
        const inV = item.inV;
        if (outV && typeof outV === 'object') {
          row._outV = `${outV.label || ''} (${String(outV.id || '').substring(0, 12)}…)`;
        } else {
          row._outV = String(outV || '');
        }
        if (inV && typeof inV === 'object') {
          row._inV = `${inV.label || ''} (${String(inV.id || '').substring(0, 12)}…)`;
        } else {
          row._inV = String(inV || '');
        }
      }

      for (const [key, val] of Object.entries(propsMap)) {
        if (val === null || val === undefined) {
          row[key] = '—';
        } else if (typeof val === 'object') {
          row[key] = JSON.stringify(val);
        } else {
          row[key] = String(val);
        }
      }

      return row;
    }

    // Generic
    if (item && typeof item === 'object') {
      for (const [key, val] of Object.entries(item)) {
        if (val === null || val === undefined) {
          row[key] = '—';
        } else if (typeof val === 'object') {
          row[key] = JSON.stringify(val);
        } else {
          row[key] = String(val);
        }
      }
    }

    return row;
  }

  /**
   * Rough memory estimate in bytes.
   * @returns {number}
   */
  _estimateMemory() {
    if (!this._data || this._data.length === 0) return 0;
    try {
      const sampleSize = Math.min(this._data.length, 10);
      const sample = this._data.slice(0, sampleSize);
      const sampleBytes = new Blob([JSON.stringify(sample)]).size;
      return Math.round((sampleBytes / sampleSize) * this._data.length);
    } catch {
      return this._data.length * 100;
    }
  }
}

