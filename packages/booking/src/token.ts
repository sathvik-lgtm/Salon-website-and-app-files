const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * `Appointment.manageTokenHash` is required by the schema, but v0 has no manage page. We store the
 * SHA-256 of a random 256-bit token and discard the token itself (nothing in v0 can use it).
 */
export async function randomManageTokenHash(): Promise<string> {
  const token = crypto.getRandomValues(new Uint8Array(32));
  const digest = await crypto.subtle.digest('SHA-256', token);
  return toHex(new Uint8Array(digest));
}
