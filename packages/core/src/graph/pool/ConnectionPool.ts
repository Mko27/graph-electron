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

/**
 * ConnectionPool — a fixed-ceiling pool of connected providers.
 *
 * Notes on the invariants this maintains, each of which was previously broken:
 *   - The slot count is reserved BEFORE connecting, so concurrent acquires
 *     cannot collectively exceed `max`.
 *   - Unhealthy slots are evicted rather than skipped, so a pool whose
 *     connections have all gone bad can refill instead of jamming forever.
 *   - A failed initialize() closes whatever it already opened instead of
 *     abandoning live connections.
 */
export class ConnectionPool {
  private readonly config: PoolConfig;
  private slots: PoolSlot[] = [];
  private waitQueue: WaitingRequest[] = [];
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  /**
   * Slots reserved but not yet connected. Counted towards `max` so that N
   * simultaneous acquires cannot each see room and all create a connection.
   */
  private pending = 0;

  constructor(
    private readonly factory: () => IGraphProvider,
    config?: Partial<PoolConfig>,
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from({ length: this.config.min }, () => this._createSlot()),
    );

    const failure = results.find((r) => r.status === 'rejected');
    if (failure) {
      // Do not leave the connections that DID open dangling.
      await this.close();
      this.closed = false; // close() is for teardown; this pool never started
      throw (failure as PromiseRejectedResult).reason;
    }

    this._startHealthChecks();
  }

  async acquire(): Promise<IGraphProvider> {
    if (this.closed) throw new Error('Connection pool is closed');

    // An idle, healthy connection is always preferred.
    const taken = this._takeIdle();
    if (taken) return taken;

    // Drop idle-but-unhealthy slots so they stop occupying the ceiling.
    await this._evictUnhealthyIdle();

    // Re-check: a release may have landed while the eviction above awaited,
    // and queueing past a now-free connection would wait for a release that
    // has already happened.
    const afterEvict = this._takeIdle();
    if (afterEvict) return afterEvict;

    // Grow if there is room, counting reservations as well as live slots.
    if (this.slots.length + this.pending < this.config.max) {
      const slot = await this._createSlot();
      slot.inUse = true;
      slot.lastUsed = Date.now();
      return slot.provider;
    }

    return new Promise<IGraphProvider>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error(`Connection pool acquire timeout after ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  /** Claim an idle, healthy slot if one exists. */
  private _takeIdle(): IGraphProvider | null {
    const idle = this.slots.find((s) => !s.inUse && s.healthy);
    if (!idle) return null;
    idle.inUse = true;
    idle.lastUsed = Date.now();
    return idle.provider;
  }

  release(provider: IGraphProvider): void {
    const slot = this.slots.find((s) => s.provider === provider);
    if (!slot) return;

    slot.inUse = false;
    slot.lastUsed = Date.now();

    // Never hand a known-bad connection to the next caller.
    if (!slot.healthy) {
      void this._discardSlot(slot);
      return;
    }

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
      connected: this.slots.some((s) => s.healthy),
      poolSize: total,
      activeConnections: active,
      idleConnections: idle,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Connection pool closed'));
    }
    this.waitQueue = [];

    const slots = this.slots;
    this.slots = [];
    await Promise.allSettled(slots.map((s) => s.provider.disconnect()));
  }

  private async _createSlot(): Promise<PoolSlot> {
    // Reserved up front: the ceiling check in acquire() reads this, so the
    // await below cannot let a second caller past the same check.
    this.pending += 1;
    try {
      const provider = this.factory();
      await provider.connect();

      // The pool may have been closed while this was connecting.
      if (this.closed) {
        await provider.disconnect().catch(() => undefined);
        throw new Error('Connection pool is closed');
      }

      const slot: PoolSlot = {
        provider,
        inUse: false,
        lastUsed: Date.now(),
        healthy: true,
      };
      this.slots.push(slot);
      return slot;
    } finally {
      this.pending -= 1;
    }
  }

  /** Disconnect and remove a slot, then let a waiter try again. */
  private async _discardSlot(slot: PoolSlot): Promise<void> {
    this.slots = this.slots.filter((s) => s !== slot);
    await slot.provider.disconnect().catch(() => undefined);
    this._pumpWaitQueue();
  }

  private async _evictUnhealthyIdle(): Promise<void> {
    const bad = this.slots.filter((s) => !s.inUse && !s.healthy);
    if (bad.length === 0) return;

    // Remove them from the pool synchronously, so the ceiling frees up without
    // waiting on the network, then close them.
    this.slots = this.slots.filter((s) => !bad.includes(s));
    await Promise.allSettled(bad.map((s) => s.provider.disconnect()));
  }

  /**
   * After a slot frees up or is discarded, give queued callers a chance —
   * otherwise a pool that evicted its last connection leaves them waiting for
   * a release that will never come.
   */
  private _pumpWaitQueue(): void {
    while (this.waitQueue.length > 0) {
      const idle = this.slots.find((s) => !s.inUse && s.healthy);

      if (idle) {
        const waiter = this.waitQueue.shift()!;
        clearTimeout(waiter.timer);
        idle.inUse = true;
        idle.lastUsed = Date.now();
        waiter.resolve(idle.provider);
        continue;
      }

      if (this.slots.length + this.pending < this.config.max && !this.closed) {
        const waiter = this.waitQueue.shift()!;
        clearTimeout(waiter.timer);
        this._createSlot().then(
          (slot) => {
            slot.inUse = true;
            slot.lastUsed = Date.now();
            waiter.resolve(slot.provider);
          },
          (err: Error) => waiter.reject(err),
        );
        continue;
      }

      return;
    }
  }

  private _startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => void this._runHealthChecks(),
      this.config.healthCheckIntervalMs,
    );
  }

  private async _runHealthChecks(): Promise<void> {
    const now = Date.now();

    // Snapshot: slots can be removed while this runs.
    for (const slot of [...this.slots]) {
      if (slot.inUse) continue;
      if (!this.slots.includes(slot)) continue;

      // Evict long-idle connections above the minimum.
      const idleDuration = now - slot.lastUsed;
      const overMin = this.slots.length > this.config.min;
      if (overMin && idleDuration > this.config.idleTimeoutMs) {
        await this._discardSlot(slot);
        continue;
      }

      let healthy: boolean;
      try {
        const state = await slot.provider.healthCheck();
        healthy = state.connected;
      } catch {
        healthy = false;
      }

      if (healthy) {
        slot.healthy = true;
        continue;
      }

      // One reconnect attempt in place, then the slot goes rather than
      // lingering as dead weight against the ceiling.
      try {
        await slot.provider.connect();
        slot.healthy = true;
      } catch {
        slot.healthy = false;
        await this._discardSlot(slot);
      }
    }

    this._pumpWaitQueue();
  }
}
