export interface GraphVertex {
  type: 'vertex';
  id: string | number;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  type: 'edge';
  id: string | number;
  label: string;
  outV: string | number;
  inV: string | number;
  outVLabel?: string;
  inVLabel?: string;
  properties: Record<string, unknown>;
}

export type GraphElement = GraphVertex | GraphEdge;

export interface QueryProfile {
  planningTimeMs?: number;
  executionTimeMs?: number;
  indexHits?: number;
}

export interface QueryMetadata {
  requestId?: string;
  statusAttributes?: Record<string, unknown>;
  warnings?: string[];
  profile?: QueryProfile;
}

export interface QueryResult<T = unknown> {
  success: boolean;
  data: T[];
  duration: number;
  count: number;
  metadata?: QueryMetadata;
}
