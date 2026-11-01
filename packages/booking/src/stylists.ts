import { z } from 'zod';
import { fail, loadContext } from './context';
import { serviceIdsSchema } from './slots';
import type { BookingPort, EngineOptions, StylistsResult } from './types';

const inputSchema = z.object({ branchId: z.string().min(1), serviceIds: serviceIdsSchema });

/**
 * The stylists a customer can pick for these services at this branch: active, bookable, based at the
 * branch and qualified for ALL the services. Sorted by name so the list is stable.
 */
export async function listStylists(
  port: BookingPort,
  input: { branchId: string; serviceIds: string[] },
  options: EngineOptions = {},
): Promise<StylistsResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');
  const loaded = await loadContext(port, { ...parsed.data, stylistId: 'ANY' }, options);
  if (!loaded.ok) return loaded;
  const stylists = loaded.context.candidates
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return { ok: true, stylists };
}
