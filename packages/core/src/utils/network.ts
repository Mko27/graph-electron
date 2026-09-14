/**
 * isLocalHost — true when a host refers to this machine.
 *
 * Used to decide whether relaxing TLS certificate verification is acceptable:
 * local development servers and emulators (the Cosmos DB emulator, for one)
 * serve self-signed certificates, while a remote endpoint must always have its
 * certificate verified. Keep this set tight — every host it matches is a host
 * where verification can legitimately be turned off.
 *
 * Matches:
 *   localhost, any *.localhost subdomain
 *   the IPv4 loopback range 127.0.0.0/8
 *   the IPv6 loopback ::1 (bare or bracketed)
 *   0.0.0.0
 */
export function isLocalHost(host: string | undefined | null): boolean {
  if (!host) return false;

  // Tolerate a scheme, a port, brackets and trailing dots so callers can pass
  // a raw config value.
  let value = String(host).trim().toLowerCase();
  if (value === '') return false;

  const schemeAt = value.indexOf('://');
  if (schemeAt !== -1) value = value.slice(schemeAt + 3);

  // Strip any path/query so "localhost:8901/gremlin" still matches.
  value = value.split('/')[0].split('?')[0];

  // Bracketed IPv6, optionally with a port: [::1]:8182
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return false;
    value = value.slice(1, close);
  } else {
    // Strip a port only when what follows the last colon is numeric — a bare
    // IPv6 address contains colons that are not port separators.
    const lastColon = value.lastIndexOf(':');
    if (lastColon !== -1) {
      const tail = value.slice(lastColon + 1);
      if (tail !== '' && /^\d+$/.test(tail) && !value.slice(0, lastColon).includes(':')) {
        value = value.slice(0, lastColon);
      }
    }
  }

  // A trailing dot denotes a fully-qualified name: "localhost." === "localhost"
  while (value.endsWith('.')) value = value.slice(0, -1);

  if (value === 'localhost' || value.endsWith('.localhost')) return true;
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (value === '0.0.0.0') return true;

  // IPv4 loopback: 127.0.0.0/8
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return false;
    return octets[0] === 127;
  }

  return false;
}
