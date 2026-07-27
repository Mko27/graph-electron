import type { Logger } from '../logging';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  label: string;
  logger?: Logger;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt);
        opts.logger?.(
          'warn',
          `${opts.label} failed (attempt ${attempt + 1}/${opts.maxAttempts + 1}), retry in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
