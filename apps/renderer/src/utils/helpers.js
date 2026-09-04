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
 * Generic "looks like a name" keys, tried after the vertex type's own keys.
 * `entity_type` sits late on purpose: it usually just repeats the vertex label.
 */
const NAME_PROPS = ['name', 'title', 'displayName', 'username', 'email', 'entity_type', 'resource_type', 'block_type'];

/**
 * Property keys Auto tries, in order, for a vertex of a given type.
 *
 * A vertex type normally carries its own subtype property — `block` has
 * `block_type`, `resource` has `resource_type`, `principal` has `principal` —
 * and that is what a reader wants to see, so those come first. Deriving them
 * from the label rather than hard-coding a table means a new vertex type gets
 * the same treatment without a code change. The generic keys follow.
 *
 * @param {string|null|undefined} vertexLabel
 * @returns {string[]}
 */
export function autoLabelCandidates(vertexLabel) {
  const label = (vertexLabel == null ? '' : String(vertexLabel)).trim();
  if (!label) return NAME_PROPS;
  const lower = label.toLowerCase();
  return [...new Set([
    `${label}_type`, `${lower}_type`,
    label, lower,
    ...NAME_PROPS,
  ])];
}

/**
 * Get a display-friendly label for a graph node
 */
export function getDisplayLabel(vertexLabel, propsMap, id) {
  for (const prop of autoLabelCandidates(vertexLabel)) {
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
/** Edges only: draw no text at all, for when the types are already obvious. */
export const LABEL_MODE_NONE  = '__none__';

export function truncateLabel(value, max = 20) {
  const str = String(value);
  return str.length > max ? str.substring(0, max) + '…' : str;
}

/**
 * Resolve the text drawn along an edge.
 *
 * Auto is the edge's type (`NESTED_IN`), which is what an edge is normally read
 * by — unlike a vertex, where the type is the least interesting thing about it.
 * A chosen property that the edge does not carry falls back to the type rather
 * than to the id, which would be unreadable on a line.
 *
 * @param {string} edgeLabel  edge type (e.g. "NESTED_IN")
 * @param {object} propsMap   flattened property map
 * @param {string} id         edge id
 * @param {string} [mode]     LABEL_MODE_* sentinel, or a property key
 */
export function computeEdgeLabel(edgeLabel, propsMap, id, mode) {
  const label = (edgeLabel != null && edgeLabel !== '') ? String(edgeLabel) : '';

  if (!mode || mode === LABEL_MODE_AUTO || mode === LABEL_MODE_LABEL) return truncateLabel(label, 24);
  if (mode === LABEL_MODE_NONE) return '';
  if (mode === LABEL_MODE_ID) return truncateLabel(id, 16);

  const value = (propsMap || {})[mode];
  if (value === undefined || value === null || value === '') return truncateLabel(label, 24);
  return truncateLabel(value, 24);
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
