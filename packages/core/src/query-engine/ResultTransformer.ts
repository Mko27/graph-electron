/**
 * ResultTransformer
 *
 * Transforms raw Gremlin driver output into normalized, IPC-serializable
 * graph elements. Ported from the original ExecuteQueryCommand.js.
 *
 * This lives in core (not in the electron app) because the same
 * normalization logic is needed regardless of where queries execute.
 */

export interface NormalizedVertex {
  type: 'vertex';
  id: string | number;
  label: string;
  [key: string]: unknown;
}

export interface NormalizedEdge {
  type: 'edge';
  id: string | number;
  label: string;
  outV: string | number;
  inV: string | number;
  outVLabel?: string;
  inVLabel?: string;
  [key: string]: unknown;
}

export type NormalizedElement = NormalizedVertex | NormalizedEdge;

export class ResultTransformer {
  flattenResults(data: unknown[]): unknown[] {
    const result: unknown[] = [];
    const flatten = (arr: unknown[]) => {
      for (const item of arr) {
        if (Array.isArray(item)) flatten(item);
        else result.push(item);
      }
    };
    flatten(data);
    return result;
  }

  mapToPlainObject(value: unknown): unknown {
    if (value == null) return value;
    if (value instanceof Map) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value) obj[k] = this.mapToPlainObject(v);
      return obj;
    }
    if (Array.isArray(value)) return value.map((v) => this.mapToPlainObject(v));
    if (typeof value === 'object') {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        obj[k] = this.mapToPlainObject(v);
      }
      return obj;
    }
    return value;
  }

  isEdge(item: unknown): item is Record<string, unknown> {
    if (!item || typeof item !== 'object') return false;
    const o = item as Record<string, unknown>;
    return (
      (o.outV !== undefined && o.inV !== undefined) ||
      (o['Direction.OUT'] !== undefined && o['Direction.IN'] !== undefined) ||
      o.type === 'edge'
    );
  }

  extractProperties(properties: unknown): Record<string, unknown> {
    if (!properties) return {};
    if (Array.isArray(properties)) {
      const result: Record<string, unknown> = {};
      for (const p of this.flattenResults(properties)) {
        if (!p || typeof p !== 'object') continue;
        const o = p as Record<string, unknown>;
        const key = (o.key ?? o.label) as string | undefined;
        if (key != null) result[key] = o.value;
      }
      return result;
    }
    if (typeof properties === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(properties as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          const first = v[0];
          result[k] = first && typeof first === 'object' && 'value' in (first as object)
            ? (first as Record<string, unknown>).value
            : first;
        } else if (v && typeof v === 'object' && 'value' in (v as object)) {
          result[k] = (v as Record<string, unknown>).value;
        } else {
          result[k] = v;
        }
      }
      return result;
    }
    return {};
  }

  processResults(data: unknown[]): NormalizedElement[] {
    return data.map((item) => {
      if (!item || typeof item !== 'object') return item as NormalizedElement;
      const o = item as Record<string, unknown>;

      if (this.isEdge(item)) {
        const outVRef = o.outV;
        const inVRef = o.inV;
        const outV = this._vertexIdFromRef(outVRef);
        const inV = this._vertexIdFromRef(inVRef);
        const outVLabel = outVRef && typeof outVRef === 'object' ? String((outVRef as Record<string, unknown>).label ?? '') : '';
        const inVLabel = inVRef && typeof inVRef === 'object' ? String((inVRef as Record<string, unknown>).label ?? '') : '';
        const props = this.extractProperties(o.properties);
        const { properties: _p, outV: _ov, inV: _iv, ...rest } = o;
        return {
          type: 'edge',
          ...props,
          ...rest,
          outV: outV ?? '',
          inV: inV ?? '',
          ...(outVLabel ? { outVLabel } : {}),
          ...(inVLabel ? { inVLabel } : {}),
        } as NormalizedEdge;
      }

      const props = this.extractProperties(o.properties);
      const { properties: _p, ...rest } = o;
      return {
        type: 'vertex',
        ...props,
        ...rest,
        id: o.id as string | number,
        label: (o.label ?? 'item') as string,
      } as NormalizedVertex;
    });
  }

  deduplicateResults(results: NormalizedElement[]): NormalizedElement[] {
    const vertexMap = new Map<string, number>();
    const seenEdgeIds = new Set<string>();
    const out: NormalizedElement[] = [];

    for (const item of results) {
      if (!item || typeof item !== 'object') { out.push(item); continue; }

      if (this.isEdge(item)) {
        const edgeId = this._resolveEdgeId((item as Record<string, unknown>).id);
        const key = edgeId || `e:${out.length}`;
        if (edgeId && seenEdgeIds.has(edgeId)) continue;
        seenEdgeIds.add(key);
        out.push(item);
        continue;
      }

      const vid = String((item as Record<string, unknown>).id ?? '');
      if (vid) {
        const existingIdx = vertexMap.get(vid);
        if (existingIdx !== undefined) { out[existingIdx] = item; continue; }
        vertexMap.set(vid, out.length);
      }
      out.push(item);
    }

    return out;
  }

  ensureSerializable<T>(results: T[]): T[] {
    try {
      return JSON.parse(JSON.stringify(results)) as T[];
    } catch {
      return results.map((r) => {
        try { return JSON.parse(JSON.stringify(r)) as T; }
        catch { return String(r) as unknown as T; }
      });
    }
  }

  private _vertexIdFromRef(ref: unknown): string | number | undefined {
    if (ref == null) return undefined;
    const flat = Array.isArray(ref) ? this.flattenResults(ref) : [ref];
    const first = flat[0];
    if (first == null) return undefined;
    return typeof first === 'object' && first !== null
      ? String((first as Record<string, unknown>).id ?? first)
      : String(first as string | number);
  }

  private _resolveEdgeId(id: unknown): string {
    if (id == null) return '';
    if (typeof id === 'string') return id;
    if (typeof id === 'number') return String(id);
    if (typeof id === 'object' && id !== null) {
      const o = id as Record<string, unknown>;
      if (o.relationId) return String(o.relationId);
      return '';
    }
    return String(id);
  }
}
