import 'server-only';
import { isSameOrigin } from '@salon/security/request';
import type { z } from 'zod';
import type { Actor } from './access';
import { getCurrentActor } from './session';

/** Shared plumbing for the API routes. Every route starts with `apiActor`. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const apiError = (code: string, status: number): Response => json({ error: code }, status);

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  SLOT_TAKEN: 409,
  SLOT_UNAVAILABLE: 409,
  WRONG_PASSWORD: 403,
  WEAK_PASSWORD: 422,
  RATE_LIMITED: 429,
};

/** A refusal from the data layer as an HTTP response (`{ error: REASON }`, no detail). */
export const refusal = (reason: string): Response => apiError(reason, STATUS[reason] ?? 422);

/**
 * The signed-in person for a route, or the response to send instead. The actor is read from the
 * server's own session and re-checked against the database: nothing the browser sends decides who
 * they are. Routes that change data (`write`) must also come from this site (Origin/Referer).
 */
export async function apiActor(
  request: Request,
  { write = false }: { write?: boolean } = {},
): Promise<{ actor: Actor } | { response: Response }> {
  if (write && !isSameOrigin(request)) return { response: apiError('FORBIDDEN', 403) };
  const found = await getCurrentActor();
  if (!found) return { response: apiError('UNAUTHENTICATED', 401) };
  if (found.mustChangePassword) return { response: apiError('PASSWORD_CHANGE_REQUIRED', 403) };
  return { actor: found.actor };
}

/** A JSON request body checked against a schema: JSON only, at most 8 KB. */
export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response }> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return { response: apiError('INVALID_INPUT', 415) };
  }
  const text = await request.text();
  if (text.length > 8 * 1024) return { response: apiError('INVALID_INPUT', 413) };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { response: apiError('INVALID_INPUT', 400) };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { response: apiError('INVALID_INPUT', 400) };
}

/** Query-string values as an object of strings, for a schema to check. */
export const queryOf = (request: Request): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams.entries());
