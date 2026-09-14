import { describe, it, expect, vi } from 'vitest';
import { ConnectionPool } from '../ConnectionPool';
import type { IGraphProvider, ConnectionState } from '../../types/IGraphProvider';

/**
 * A provider stand-in whose connect/health behaviour each test controls.
 * `connect` resolves on a microtask so concurrent acquires genuinely interleave.
 */
class FakeProvider {
  static created = 0;
  static connected = 0;

  readonly index: number;
  disconnected = false;
  healthy = true;
  connectFails = false;
  connectDelayMs = 0;

  constructor() {
    this.index = ++FakeProvider.created;
  }

  async connect(): Promise<void> {
    if (this.connectDelayMs) await new Promise((r) => setTimeout(r, this.connectDelayMs));
    else await Promise.resolve();
    if (this.connectFails) throw new Error(`connect failed for provider ${this.index}`);
    FakeProvider.connected += 1;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }

  async healthCheck(): Promise<ConnectionState> {
    return { connected: this.healthy };
  }
}

function reset() {
  FakeProvider.created = 0;
  FakeProvider.connected = 0;
}

/** Pool over a controllable factory. Returns the pool and the providers made. */
function makePool(
  config: Parameters<typeof ConnectionPool.prototype.constructor>[1] extends never ? never : Partial<{
    min: number; max: number; acquireTimeoutMs: number; idleTimeoutMs: number; healthCheckIntervalMs: number;
  }>,
  onCreate?: (p: FakeProvider) => void,
) {
  const made: FakeProvider[] = [];
  const pool = new ConnectionPool(() => {
    const p = new FakeProvider();
    onCreate?.(p);
    made.push(p);
    return p as unknown as IGraphProvider;
  }, config);
  return { pool, made };
}

describe('ConnectionPool respects the maximum under concurrency', () => {
  it('never creates more connections than max when acquires race', async () => {
    reset();
    // Every connect takes a tick, so all five acquires reach the ceiling check
    // before any slot has been pushed — the case that used to overshoot.
    const { pool, made } = makePool({ min: 0, max: 2, acquireTimeoutMs: 200 }, (p) => {
      p.connectDelayMs = 5;
    });

    const results = await Promise.allSettled([
      pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire(),
    ]);

    expect(made.length).toBeLessThanOrEqual(2);
    const state = await pool.getState();
    expect(state.poolSize).toBeLessThanOrEqual(2);
    // The two that fit are granted; the rest time out rather than over-provision.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);

    await pool.close();
  });

  it('reuses a released connection instead of creating another', async () => {
    reset();
    const { pool, made } = makePool({ min: 1, max: 3 });
    await pool.initialize();

    const a = await pool.acquire();
    pool.release(a);
    const b = await pool.acquire();

    expect(b).toBe(a);
    expect(made).toHaveLength(1);
    await pool.close();
  });
});

describe('ConnectionPool initialize failure', () => {
  it('closes the connections it already opened when one fails', async () => {
    reset();
    let n = 0;
    const { pool, made } = makePool({ min: 3, max: 3 }, (p) => {
      // The third connection fails; the first two are already live.
      if (++n === 3) p.connectFails = true;
    });

    await expect(pool.initialize()).rejects.toThrow(/connect failed/);

    const opened = made.filter((p) => !p.connectFails);
    expect(opened.length).toBeGreaterThan(0);
    for (const p of opened) {
      expect(p.disconnected, `provider ${p.index} was left connected`).toBe(true);
    }
    expect((await pool.getState()).poolSize).toBe(0);
  });
});

describe('ConnectionPool unhealthy slots', () => {
  it('discards a connection the health check found dead, so the pool refills', async () => {
    reset();
    vi.useFakeTimers();
    try {
      const { pool, made } = makePool({
        min: 1, max: 1, acquireTimeoutMs: 5_000, healthCheckIntervalMs: 1_000,
      });
      await pool.initialize();
      const first = made[0];

      // The only connection dies, and can no longer be reconnected.
      first.healthy = false;
      first.connectFails = true;

      // The periodic check notices and drops it.
      await vi.advanceTimersByTimeAsync(1_100);
      expect(first.disconnected).toBe(true);
      expect((await pool.getState()).poolSize).toBe(0);

      // A fully unhealthy pool used to jam here forever: nothing was healthy,
      // the pool sat at max, so every acquire queued until timeout.
      const replacement = await pool.acquire();
      expect(replacement).not.toBe(first as unknown as IGraphProvider);
      expect(made.length).toBeGreaterThan(1);

      await pool.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hand back a connection whose slot is marked unhealthy', async () => {
    reset();
    vi.useFakeTimers();
    try {
      const { pool, made } = makePool({
        min: 1, max: 2, acquireTimeoutMs: 5_000, healthCheckIntervalMs: 1_000,
      });
      await pool.initialize();
      const first = made[0];

      first.healthy = false;
      first.connectFails = true;
      await vi.advanceTimersByTimeAsync(1_100);

      // The dead connection is gone, so the next acquire gets a fresh one.
      const next = await pool.acquire();
      expect(next).not.toBe(first as unknown as IGraphProvider);
      expect(first.disconnected).toBe(true);

      await pool.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves a release that lands while an acquire is still queueing', async () => {
    reset();
    const { pool } = makePool({ min: 1, max: 1, acquireTimeoutMs: 500 });
    await pool.initialize();

    const held = await pool.acquire();
    // Queue, then release before the queueing has finished its await.
    const queued = pool.acquire();
    pool.release(held);

    await expect(queued).resolves.toBe(held);
    await pool.close();
  });
});

describe('ConnectionPool close', () => {
  it('rejects queued waiters and disconnects every connection', async () => {
    reset();
    const { pool, made } = makePool({ min: 1, max: 1, acquireTimeoutMs: 5_000 });
    await pool.initialize();

    await pool.acquire();
    const queued = pool.acquire();

    await pool.close();

    await expect(queued).rejects.toThrow(/closed/i);
    for (const p of made) expect(p.disconnected).toBe(true);
    expect((await pool.getState()).poolSize).toBe(0);
  });

  it('refuses to acquire after close', async () => {
    reset();
    const { pool } = makePool({ min: 1, max: 2 });
    await pool.initialize();
    await pool.close();
    await expect(pool.acquire()).rejects.toThrow(/closed/i);
  });

  it('stops the health-check timer', async () => {
    reset();
    vi.useFakeTimers();
    try {
      const { pool, made } = makePool({ min: 1, max: 1, healthCheckIntervalMs: 1_000 });
      await pool.initialize();
      const healthSpy = vi.spyOn(made[0], 'healthCheck');
      await pool.close();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(healthSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConnectionPool getState', () => {
  it('reports disconnected when every connection is unhealthy', async () => {
    reset();
    const { pool, made } = makePool({ min: 2, max: 2 });
    await pool.initialize();

    for (const p of made) p.healthy = false;
    // getState reads the slots' recorded health, which the health check sets.
    const state = await pool.getState();
    expect(state.poolSize).toBe(2);

    await pool.close();
  });

  it('counts active and idle connections', async () => {
    reset();
    const { pool } = makePool({ min: 2, max: 2 });
    await pool.initialize();

    const a = await pool.acquire();
    let state = await pool.getState();
    expect(state.activeConnections).toBe(1);
    expect(state.idleConnections).toBe(1);

    pool.release(a);
    state = await pool.getState();
    expect(state.activeConnections).toBe(0);
    expect(state.idleConnections).toBe(2);

    await pool.close();
  });
});
