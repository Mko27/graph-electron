export interface ProviderCapabilities {
  readonly supportsTransactions: boolean;
  readonly supportsSchema: boolean;
  readonly supportsMultiGraph: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsGremlin: boolean;
  readonly supportsCypher: boolean;
  readonly supportsOpenCypher: boolean;
  readonly supportsNGQL: boolean;
  readonly supportsSPARQL: boolean;
  readonly supportsGraphQL: boolean;
  readonly supportsBulkLoad: boolean;
  readonly supportsPropertyGraph: boolean;
  readonly supportsRDFGraph: boolean;
  readonly maxConnectionsPerPool: number;
}
