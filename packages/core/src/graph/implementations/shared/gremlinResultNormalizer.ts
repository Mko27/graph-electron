// The `gremlin` npm package's default GraphSON reader deserializes `g:Map` and `g:Set`
// into real JS Map/Set instances (see node_modules/gremlin/lib/structure/io/type-serializers.js).
// Map/Set store their data in internal slots, not as own-enumerable properties, so
// JSON.stringify(...) — used by both the JSON view and IPC error logging — renders them
// as "{}", and plain-object shape checks (isNeptuneVertex/isNeptuneEdge, Object.entries)
// silently see no data. This shows up on any query step that returns a map/set, e.g.
// elementMap(), valueMap(), group().by(), and Path.labels.
//
// Vertex/Edge/Path/Property/VertexProperty instances are unaffected (their data lives in
// own-enumerable properties already), but we still rebuild them as plain objects here so
// every Gremlin provider hands the rest of the app (JSON view, graph view, IPC) uniform,
// JSON-safe data regardless of which step produced it.
export function normalizeGremlinResult(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;

  if (Array.isArray(value)) return value.map((v) => normalizeGremlinResult(v));

  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) obj[String(k)] = normalizeGremlinResult(v);
    return obj;
  }

  if (value instanceof Set) return Array.from(value, (v) => normalizeGremlinResult(v));

  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) obj[k] = normalizeGremlinResult(v);
  return obj;
}
