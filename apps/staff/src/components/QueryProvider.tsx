'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/** TanStack Query for the staff screens: it refetches the schedule every ~20 seconds. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A failed request is retried once, then shown: a front desk should not wait on silent retries.
            retry: 1,
            refetchOnWindowFocus: true,
            staleTime: 0,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
