import type { IGraphProvider } from '../types/IGraphProvider';
import type { DatabaseType, ProviderConnectionConfig } from '../types/IConnectionConfig';
import type { Logger } from '../implementations/BaseProvider';

export type ProviderFactory = (
  id: string,
  config: ProviderConnectionConfig,
  logger?: Logger,
) => IGraphProvider;

interface ProviderEntry {
  factory: ProviderFactory;
  displayName: string;
  description: string;
}

/**
 * Global registry for graph database providers.
 *
 * Providers register themselves on module load. The ConnectionFactory
 * queries this registry to instantiate the correct provider for a config.
 *
 * This registry is the extension point for a future plugin system — a plugin
 * simply calls register() with its own factory and it becomes available
 * throughout the app without any core code changes.
 */
export class ProviderRegistry {
  private static readonly instance = new ProviderRegistry();
  private readonly entries = new Map<DatabaseType, ProviderEntry>();

  static getInstance(): ProviderRegistry {
    return ProviderRegistry.instance;
  }

  register(
    dbType: DatabaseType,
    factory: ProviderFactory,
    meta: { displayName: string; description: string },
  ): void {
    this.entries.set(dbType, { factory, ...meta });
  }

  resolve(dbType: DatabaseType): ProviderFactory {
    const entry = this.entries.get(dbType);
    if (!entry) {
      const registered = [...this.entries.keys()].join(', ');
      throw new Error(
        `No provider registered for database type "${dbType}". ` +
        `Registered: ${registered || '(none)'}`,
      );
    }
    return entry.factory;
  }

  has(dbType: DatabaseType): boolean {
    return this.entries.has(dbType);
  }

  listAll(): Array<{ dbType: DatabaseType; displayName: string; description: string }> {
    return [...this.entries.entries()].map(([dbType, entry]) => ({
      dbType,
      displayName: entry.displayName,
      description: entry.description,
    }));
  }
}
