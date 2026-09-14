import { ProviderRegistry } from '../registry/ProviderRegistry';
import { DialectRegistry } from '../registry/DialectRegistry';
import { DIALECT_COMPATIBILITY } from '../types/IConnectionConfig';
import type { IGraphProvider } from '../types/IGraphProvider';
import type { ProviderConnectionConfig, DatabaseType } from '../types/IConnectionConfig';
import type { IQueryDialect } from '../types/IDialect';
import type { Logger } from '../implementations/BaseProvider';

import { NeptuneProvider } from '../implementations/neptune/NeptuneProvider';
import { Neo4jProvider } from '../implementations/neo4j/Neo4jProvider';
import { JanusGraphProvider } from '../implementations/janusgraph/JanusGraphProvider';
import { ArangoProvider } from '../implementations/arangodb/ArangoProvider';
import { CosmosDBProvider } from '../implementations/cosmosdb/CosmosDBProvider';
import { OrientDBProvider } from '../implementations/orientdb/OrientDBProvider';
import { TigerGraphProvider } from '../implementations/tigergraph/TigerGraphProvider';
import { NebulaProvider } from '../implementations/nebula/NebulaProvider';
import { TinkerPopProvider } from '../implementations/tinkerpop/TinkerPopProvider';
import { GremlinDialect } from '../dialects/GremlinDialect';
import { CypherDialect } from '../dialects/CypherDialect';
import { OpenCypherDialect } from '../dialects/OpenCypherDialect';
import { NGQLDialect } from '../dialects/NGQLDialect';
import { SPARQLDialect } from '../dialects/SPARQLDialect';
import { AQLDialect } from '../dialects/AQLDialect';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderCtor = new (id: string, cfg: any, logger?: Logger) => IGraphProvider;

interface ProviderMeta {
  Ctor: ProviderCtor;
  displayName: string;
  description: string;
}

const PROVIDER_CATALOG: Record<DatabaseType, ProviderMeta> = {
  neptune: {
    Ctor: NeptuneProvider,
    displayName: 'Amazon Neptune',
    description: 'AWS managed graph database — Gremlin & openCypher',
  },
  neo4j: {
    Ctor: Neo4jProvider,
    displayName: 'Neo4j',
    description: 'Cypher-native graph database with ACID transactions',
  },
  janusgraph: {
    Ctor: JanusGraphProvider,
    displayName: 'JanusGraph',
    description: 'Distributed graph database with Gremlin API',
  },
  arangodb: {
    Ctor: ArangoProvider,
    displayName: 'ArangoDB',
    description: 'Multi-model graph database with AQL & GraphQL',
  },
  cosmosdb: {
    Ctor: CosmosDBProvider,
    displayName: 'Azure Cosmos DB Gremlin',
    description: 'Azure Cosmos DB with Apache TinkerPop Gremlin API',
  },
  orientdb: {
    Ctor: OrientDBProvider,
    displayName: 'OrientDB',
    description: 'Multi-model database with Gremlin TinkerPop support',
  },
  tigergraph: {
    Ctor: TigerGraphProvider,
    displayName: 'TigerGraph',
    description: 'Scalable graph analytics database with GSQL & GraphQL',
  },
  nebula: {
    Ctor: NebulaProvider,
    displayName: 'NebulaGraph',
    description: 'Distributed graph database with nGQL dialect',
  },
  tinkerpop: {
    Ctor: TinkerPopProvider,
    displayName: 'Apache TinkerPop',
    description: 'Generic TinkerPop 3.x Gremlin server',
  },
};

const DIALECT_CATALOG = [
  new GremlinDialect(),
  new CypherDialect(),
  new OpenCypherDialect(),
  new NGQLDialect(),
  new SPARQLDialect(),
  new AQLDialect(),
];

let _initialized = false;

function bootstrap(): void {
  if (_initialized) return;
  _initialized = true;

  const providers = ProviderRegistry.getInstance();
  const dialects = DialectRegistry.getInstance();

  for (const [dbType, meta] of Object.entries(PROVIDER_CATALOG) as [DatabaseType, ProviderMeta][]) {
    providers.register(
      dbType,
      (id, cfg, logger) => new meta.Ctor(id, cfg, logger),
      { displayName: meta.displayName, description: meta.description },
    );
  }

  for (const dialect of DIALECT_CATALOG) {
    dialects.register(dialect);
  }
}

/**
 * ConnectionFactory — the single entry point for creating providers and resolving dialects.
 *
 * Usage:
 *   const factory = new ConnectionFactory();
 *   const provider = factory.createProvider(config, logger);
 *   await provider.connect();
 */
export class ConnectionFactory {
  private readonly providers = ProviderRegistry.getInstance();
  private readonly dialects = DialectRegistry.getInstance();

  constructor() {
    bootstrap();
  }

  /**
   * Validate + instantiate a provider. Does NOT connect — caller owns the lifecycle.
   */
  createProvider(config: ProviderConnectionConfig, logger?: Logger): IGraphProvider {
    this.validateConfig(config);
    const factory = this.providers.resolve(config.dbType);
    return factory(config.id, config, logger);
  }

  getDialect(name: Parameters<DialectRegistry['resolve']>[0]): IQueryDialect {
    return this.dialects.resolve(name);
  }

  validateConfig(config: ProviderConnectionConfig): void {
    if (!config.id?.trim()) throw new Error('Connection config must have a non-empty id');
    if (!config.host?.trim()) throw new Error('Connection config must have a non-empty host');
    if (!config.port || config.port < 1 || config.port > 65535) {
      throw new Error(`Invalid port: ${config.port}`);
    }

    const supported = DIALECT_COMPATIBILITY[config.dbType];
    if (!supported) throw new Error(`Unknown database type: "${config.dbType}"`);

    if (!supported.includes(config.dialect)) {
      throw new Error(
        `Dialect "${config.dialect}" is incompatible with "${config.dbType}". ` +
        `Supported: ${supported.join(', ')}`,
      );
    }
  }

  listProviders(): ReturnType<ProviderRegistry['listAll']> {
    return this.providers.listAll();
  }

  listDialects(): ReturnType<DialectRegistry['listAll']> {
    return this.dialects.listAll();
  }
}
