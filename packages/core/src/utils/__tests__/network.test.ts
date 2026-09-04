import { describe, it, expect } from 'vitest';
import { isLocalHost } from '../network';

describe('isLocalHost — local endpoints', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'localhost.',
    'localhost:8901',
    'my-emulator.localhost',
    '127.0.0.1',
    '127.0.0.1:8081',
    '127.1.2.3',
    '127.255.255.255',
    '0.0.0.0',
    '::1',
    '[::1]',
    '[::1]:8182',
    '0:0:0:0:0:0:0:1',
    'wss://localhost:8901/',
    'https://127.0.0.1:8081',
    'localhost:8901/gremlin',
  ])('treats %s as local', (host) => {
    expect(isLocalHost(host)).toBe(true);
  });
});

describe('isLocalHost — remote endpoints', () => {
  it.each([
    'my-account.gremlin.cosmos.azure.com',
    'my-account.gremlin.cosmos.azure.com:443',
    'cluster.us-east-1.neptune.amazonaws.com',
    '10.0.0.5',
    '192.168.1.10',
    '128.0.0.1',
    '126.255.255.255',
    '8.8.8.8',
    'notlocalhost.com',
    'localhost.example.com',
    'sneaky-localhost',
    '2001:db8::1',
    '[2001:db8::1]:443',
  ])('treats %s as remote', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });

  it('does not match a hostname that merely contains "localhost"', () => {
    // A domain an attacker controls must never be treated as local.
    expect(isLocalHost('localhost.attacker.example')).toBe(false);
    expect(isLocalHost('evil-localhost.io')).toBe(false);
  });

  it('rejects out-of-range IPv4 octets rather than matching loosely', () => {
    expect(isLocalHost('127.0.0.999')).toBe(false);
  });
});

describe('isLocalHost — empty and malformed input', () => {
  it.each([undefined, null, '', '   '])('returns false for %s', (host) => {
    expect(isLocalHost(host as string | undefined | null)).toBe(false);
  });

  it('returns false for an unterminated IPv6 bracket', () => {
    expect(isLocalHost('[::1')).toBe(false);
  });
});
