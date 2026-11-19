export const DEFAULT_PORT = 3000;

// Hosting platforms hand us the port in PORT. Missing or empty: default. Anything that is not
// an integer from 1 to 65535: default, with a fixed warning (the raw value is never logged).
export function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  console.warn('[server] PORT is not a valid port number, using ' + DEFAULT_PORT + '.');
  return DEFAULT_PORT;
}
