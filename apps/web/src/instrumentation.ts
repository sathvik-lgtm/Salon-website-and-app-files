import type { Instrumentation } from 'next';
import { getEnv } from '@salon/security/env';
import { reportError } from '@salon/security/error-report';

/**
 * Reports server errors to Sentry when SENTRY_DSN is set (a secret on Cloudflare; absent locally).
 * Only the route pattern and method go with the error, never the real URL, headers or body.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportError(
    error,
    { app: 'web', route: context.routePath, method: request.method },
    { dsn: getEnv('SENTRY_DSN') },
  );
};
