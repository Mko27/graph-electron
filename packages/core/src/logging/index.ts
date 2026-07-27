/**
 * Logging abstraction.
 *
 * Core business logic uses this Logger type rather than console.* directly.
 * The Electron app injects a logger that forwards to both console and the renderer.
 * Tests inject a no-op or spy logger.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, ...args: unknown[]) => void;

export const noopLogger: Logger = () => undefined;

export const consoleLogger: Logger = (level, ...args) => {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
};
