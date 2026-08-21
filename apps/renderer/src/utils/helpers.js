// ===== Neptune Data Helpers =====

/**
 * Neptune returns properties as ARRAY: [{key: "name", value: "val"}, ...]
 * This converts to a simple map: {name: "val", ...}
 */
export function neptunePropsToMap(properties) {
  if (!properties) return {};
  if (Array.isArray(properties)) {
    const map = {};
    properties.forEach(p => {
      if (p && p.key !== undefined) {
        map[p.key] = p.value;
      } else if (p && p.label !== undefined && p.value !== undefined) {
        map[p.label] = p.value;
      }
    });
    return map;
  }
  if (typeof properties === 'object') {
    const map = {};
    Object.entries(properties).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        map[k] = v.map(p => p.value !== undefined ? p.value : p).join(', ');
      } else if (v && v.value !== undefined) {
        map[k] = v.value;
      } else {
        map[k] = v;
      }
    });
    return map;
  }
  return {};
}

/**
 * Neptune edge IDs can be objects {relationId: "..."}
 */
export function resolveId(id) {
  if (id === null || id === undefined) return '';
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return String(id);
  if (typeof id === 'object') {
    if (id.relationId) return id.relationId;
    return JSON.stringify(id);
  }
  return String(id);
}

/**
 * Check if an item is an edge (Neptune format)
 */
export function isNeptuneEdge(item) {
  return item && typeof item === 'object' &&
    item.outV !== undefined && item.inV !== undefined;
}

/**
 * Check if an item is a vertex (Neptune format).
 * Label may be undefined (e.g. from enrichment); we treat as vertex if it has id and is not an edge.
 */
export function isNeptuneVertex(item) {
  return item && typeof item === 'object' &&
    item.id !== undefined &&
    item.outV === undefined && item.inV === undefined;
}

/**
 * Escape HTML characters for safe rendering.
 * Uses string replacement instead of DOM element creation for performance.
 */
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const HTML_ESCAPE_RE = /[&<>"']/g;

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(HTML_ESCAPE_RE, ch => HTML_ESCAPE_MAP[ch]);
}

/**
 * Get a display-friendly label for a graph node
 */
export function getDisplayLabel(vertexLabel, propsMap, id) {
  const nameProps = ['name', 'title', 'displayName', 'username', 'email', 'entity_type', 'resource_type', 'block_type'];
  for (const prop of nameProps) {
    if (propsMap[prop] !== undefined && propsMap[prop] !== null && propsMap[prop] !== '') {
      const val = String(propsMap[prop]);
      if (val.length > 20) return val.substring(0, 20) + '…';
      return val;
    }
  }
  const shortId = String(id).substring(0, 8);
  const label = (vertexLabel != null && vertexLabel !== '') ? String(vertexLabel) : 'item';
  return `${label}\n${shortId}`;
}

// ===== Node labelling =====

/**
 * Sentinel values for the graph node-label selector. Anything else is treated
 * as a literal property key to read off the node.
 */
export const LABEL_MODE_AUTO  = '__auto__';
export const LABEL_MODE_LABEL = '__label__';
export const LABEL_MODE_ID    = '__id__';

export function truncateLabel(value, max = 20) {
  const str = String(value);
  return str.length > max ? str.substring(0, max) + '…' : str;
}

/**
 * Resolve the text drawn inside a graph node.
 *
 * @param {string} fullLabel  vertex label (e.g. "person")
 * @param {object} propsMap   flattened property map
 * @param {string} id         vertex id
 * @param {string} [mode]     LABEL_MODE_* sentinel, or a property key
 */
export function computeNodeLabel(fullLabel, propsMap, id, mode) {
  const props = propsMap || {};

  if (!mode || mode === LABEL_MODE_AUTO) {
    return getDisplayLabel(fullLabel, props, id);
  }
  if (mode === LABEL_MODE_LABEL) {
    return (fullLabel != null && fullLabel !== '') ? truncateLabel(fullLabel) : 'item';
  }
  if (mode === LABEL_MODE_ID) {
    return truncateLabel(id, 16);
  }

  const value = props[mode];
  if (value === undefined || value === null || value === '') {
    // The chosen property is missing on this node — fall back to label + short
    // id so it never renders blank.
    return getDisplayLabel(fullLabel, {}, id);
  }
  return truncateLabel(value);
}
