import type { IGraphProvider, ConnectionState } from '../types/IGraphProvider';

export interface PoolConfig {
  min: number;
  max: number;
  acquireTimeoutMs: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;
}

const DEFAULT_POOL_CONFIG: PoolConfig = {
  min: 1,
  max: 5,
  acquireTimeoutMs: 10_000,
  idleTimeoutMs: 60_000,
  healthCheckIntervalMs: 30_000,
};

interface PoolSlot {
  provider: IGraphProvider;
  inUse: boolean;
  lastUsed: number;
  healthy: boolean;
}

interface WaitingRequest {
  resolve: (provider: IGraphProvider) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ConnectionPool {
  private readonly config: PoolConfig;
  private slots: PoolSlot[] = [];
  private waitQueue: WaitingRequest[] = [];
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly factory: () => IGraphProvider,
    config?: Partial<PoolConfig>,
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    const initializes = Array.from({ length: this.config.min }, () =>
      this._createSlot(),
    );
    await Promise.all(initializes);
    this._startHealthChecks();
  }

  async acquire(): Promise<IGraphProvider> {
    if (this.closed) throw new Error('Connection pool is closed');

    // Try to get an idle healthy connection
    const idle = this.slots.find((s) => !s.inUse && s.healthy);
    if (idle) {
      idle.inUse = true;
      idle.lastUsed = Date.now();
      return idle.provider;
    }

    // Grow the pool if under max
    if (this.slots.length < this.config.max) {
      const slot = await this._createSlot();
      slot.inUse = true;
      return slot.provider;
    }

    // Queue the request
    return new Promise<IGraphProvider>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error(`Connection pool acquire timeout after ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  release(provider: IGraphProvider): void {
    const slot = this.slots.find((s) => s.provider === provider);
    if (!slot) return;

    slot.inUse = false;
    slot.lastUsed = Date.now();

    // Dispatch to next waiter
    const waiter = this.waitQueue.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      slot.inUse = true;
      waiter.resolve(slot.provider);
    }
  }

  async getState(): Promise<ConnectionState> {
    const total = this.slots.length;
    const active = this.slots.filter((s) => s.inUse).length;
    const idle = total - active;
    return {
      connected: total > 0,
      poolSize: total,
      activeConnections: active,
      idleConnections: idle,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

    // Reject pending waiters
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Connection pool closed'));
    }
    this.waitQueue = [];

    await Promise.allSettled(this.slots.map((s) => s.provider.disconnect()));
    this.slots = [];
  }

  private async _createSlot(): Promise<PoolSlot> {
    const provider = this.factory();
    await provider.connect();
    const slot: PoolSlot = {
      provider,
      inUse: false,
      lastUsed: Date.now(),
      healthy: true,
    };
    this.slots.push(slot);
    return slot;
  }

  private _startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => void this._runHealthChecks(),
      this.config.healthCheckIntervalMs,
    );
  }

  private async _runHealthChecks(): Promise<void> {
    const now = Date.now();

    for (const slot of this.slots) {
      if (slot.inUse) continue;

      // Evict long-idle connections above min threshold
      const idleDuration = now - slot.lastUsed;
      const overMin = this.slots.length > this.config.min;
      if (overMin && idleDuration > this.config.idleTimeoutMs) {
        await slot.provider.disconnect().catch(() => undefined);
        this.slots = this.slots.filter((s) => s !== slot);
        continue;
      }

      try {
        const state = await slot.provider.healthCheck();
        slot.healthy = state.connected;
      } catch {
        slot.healthy = false;
        // Attempt reconnect
        try {
          await slot.provider.connect();
          slot.healthy = true;
        } catch {
          // Give up; slot will be replaced on next acquire
        }
      }
    }
  }
}
