/** Browser-side calls to the staff API, with plain-language errors. */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function handle<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? 'SERVER_ERROR', response.status);
  return body;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return handle<T>(await fetch(url, { signal, credentials: 'same-origin' }));
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** What a person reads when a request fails. Never shows technical detail. */
export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'NETWORK';
  switch (code) {
    case 'UNAUTHENTICATED':
    case 'PASSWORD_CHANGE_REQUIRED':
      return 'Your session has ended. Please sign in again.';
    case 'FORBIDDEN':
      return 'You do not have permission to do that.';
    case 'NOT_FOUND':
      return 'That could not be found.';
    case 'INVALID_TRANSITION':
      return 'That booking cannot be changed that way any more.';
    case 'CONFLICT':
      return 'Someone else has just changed this booking. It has been refreshed.';
    case 'SLOT_TAKEN':
    case 'SLOT_UNAVAILABLE':
      return 'That time is not free for that stylist. Please pick another time.';
    case 'INVALID_PHONE':
      return 'That phone number does not look right.';
    case 'STYLIST_NOT_ELIGIBLE':
    case 'SERVICE_UNAVAILABLE':
    case 'BRANCH_NOT_FOUND':
      return 'Those choices are not available together. Please check them.';
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment.';
    case 'NETWORK':
      return 'Could not reach the server. Check the connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
