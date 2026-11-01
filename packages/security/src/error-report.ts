/**
 * Server-side error reports to Sentry that cannot carry personal details.
 *
 * Why not the Sentry SDK: it is large (our Workers bundles are already big), and its Cloudflare setup
 * cannot be proven without a real deploy. Sentry's envelope endpoint is a documented plain HTTP POST,
 * so this is a few lines that we can test here. Browser-side errors are not reported (see FUTURE.md).
 *
 * What is sent: the error's class name, its first message line with emails and long digit runs
 * blanked, the stack (file names and line numbers only), the route pattern, and the method.
 * What is never sent: request bodies, headers, cookies, query strings, IP addresses, user details.
 */

export interface ErrorContext {
  /** The route pattern, e.g. `/api/bookings` or `/bookings/[id]`; never the real URL. */
  route?: string;
  method?: string;
  /** Which app reported it. */
  app: string;
}

const MAX_MESSAGE = 120;

/** First line only (database errors put the data on later lines), emails and 6+ digit runs removed. */
export function scrubMessage(message: string): string {
  const firstLine = message.trim().split('\n')[0] ?? '';
  return firstLine
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{4,}\d/g, '[number]')
    .slice(0, MAX_MESSAGE);
}

/** The route without a query string or real ids, so it never holds a person's details. */
export function scrubRoute(route: string | undefined): string | undefined {
  return route?.split('?')[0]?.slice(0, 200);
}

interface Frame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
}

/** "at fn (file:line:col)" lines into frames; Sentry wants the oldest call first. */
function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    frames.push({
      function: match[1],
      filename: match[2] ?? '?',
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
  }
  return frames.reverse();
}

export interface SentryTarget {
  /** The envelope endpoint and the DSN that authorises it. */
  endpoint: string;
  dsn: string;
}

/** `https://<key>@<host>/<project>` into the endpoint Sentry documents (`/api/<project>/envelope/`). */
export function parseDsn(dsn: string | undefined): SentryTarget | undefined {
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!url.username || !project || url.protocol !== 'https:') return undefined;
    return { endpoint: `https://${url.host}/api/${project}/envelope/`, dsn };
  } catch {
    return undefined;
  }
}

export function buildEnvelope(
  error: unknown,
  context: ErrorContext,
  dsn: string,
  now: Date = new Date(),
  eventId: string = crypto.randomUUID().replaceAll('-', ''),
): string {
  const err = error instanceof Error ? error : undefined;
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : undefined;
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: 'javascript',
    level: 'error',
    server_name: context.app,
    exception: {
      values: [
        {
          type: err?.name ?? 'NonError',
          value: scrubMessage(err ? err.message : String(error)),
          stacktrace: { frames: parseStack(err?.stack) },
        },
      ],
    },
    tags: { app: context.app, ...(code ? { code } : {}), ...(context.method ? { method: context.method } : {}) },
    transaction: scrubRoute(context.route),
  };
  const header = JSON.stringify({ event_id: eventId, dsn, sent_at: now.toISOString() });
  const payload = JSON.stringify(event);
  const itemHeader = JSON.stringify({ type: 'event', length: new TextEncoder().encode(payload).length });
  return `${header}\n${itemHeader}\n${payload}\n`;
}

// A burst of identical failures (the database being down) must not use up the free allowance.
const MAX_PER_MINUTE = 20;
let windowStart = 0;
let sentInWindow = 0;

function withinBudget(nowMs: number): boolean {
  if (nowMs - windowStart > 60_000) {
    windowStart = nowMs;
    sentInWindow = 0;
  }
  sentInWindow += 1;
  return sentInWindow <= MAX_PER_MINUTE;
}

/** Test hook: forget the per-minute count. */
export function resetErrorBudget(): void {
  windowStart = 0;
  sentInWindow = 0;
}

/**
 * Sends one report. Does nothing when no DSN is set (local development) and never throws: a broken
 * reporter must not turn a handled error into a second failure.
 */
export async function reportError(
  error: unknown,
  context: ErrorContext,
  options: { dsn: string | undefined; fetchImpl?: typeof fetch; now?: Date },
): Promise<boolean> {
  const target = parseDsn(options.dsn);
  if (!target) return false;
  const now = options.now ?? new Date();
  if (!withinBudget(now.getTime())) return false;
  try {
    const response = await (options.fetchImpl ?? fetch)(target.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: buildEnvelope(error, context, target.dsn, now),
    });
    return response.ok;
  } catch {
    return false;
  }
}
