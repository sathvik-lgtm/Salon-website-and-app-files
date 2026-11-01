export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Rules for a password someone chooses for themselves (the temporary one is generated). Length does
 * the real work; the other rules just stop the obvious mistakes. Returns a plain message, or null
 * when the password is acceptable.
 */
export function checkNewPassword(
  password: string,
  context: { current?: string; email?: string } = {},
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (new Set(password).size < 4) return 'Use a mix of different characters.';
  if (context.current !== undefined && password === context.current) {
    return 'Choose a password different from the current one.';
  }
  const email = context.email?.trim().toLowerCase();
  const local = email?.split('@')[0];
  if (
    email &&
    (password.toLowerCase() === email ||
      (local && local.length >= 4 && password.toLowerCase().includes(local)))
  ) {
    return 'Do not use your email address in your password.';
  }
  return null;
}
