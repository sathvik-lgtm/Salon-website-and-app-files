/**
 * Workers-compatible password hashing: PBKDF2-SHA256 via WebCrypto (native, so JS CPU time stays minimal).
 * Format: pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
 * NOTE: workerd caps PBKDF2 iterations at 100000. Raise only after checking current limits.
 * TODO(M5): measure real CPU cost on a deployed Worker against the Free plan 10 ms cap.
 */
const ITERATIONS = 100_000;
const KEY_BYTES = 32;

const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
      key,
      KEY_BYTES * 8,
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, alg, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || alg !== 'sha256' || !iter || !saltB64 || !hashB64) return false;
  const expected = unb64(hashB64);
  const actual = await derive(password, unb64(saltB64), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Random one-time password for staff reset (no email exists, so it is shown once to the resetter). */
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
