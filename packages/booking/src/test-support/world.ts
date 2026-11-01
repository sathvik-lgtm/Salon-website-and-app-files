import type { MemData, MemStaff } from './memory-port';
import type { ScheduleRow } from '../types';

/** Mon-Sun, one window per day. */
export const weekly = (startMinute: number, endMinute: number): ScheduleRow[] =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute, endMinute }));

const openDay = { open: '10:00', close: '20:00' };
export const allWeekHours = {
  mon: openDay,
  tue: openDay,
  wed: openDay,
  thu: openDay,
  fri: openDay,
  sat: openDay,
  sun: openDay,
};

export const H = (hours: number, minutes = 0) => hours * 60 + minutes;

/**
 * A small salon: one branch in Asia/Kolkata (open 10:00-20:00 every day), services `cut` (60 min,
 * ₹600), `colour` (120 min, ₹3500) and `trim` (30 min, ₹300), and stylists s1/s2/s3 (10:00-19:00,
 * qualified for everything). Tests then change what they need.
 */
export function makeWorld(): MemData {
  const stylist = (id: string, extra: Partial<MemStaff> = {}): MemStaff => ({
    id,
    homeBranchId: 'b1',
    serviceIds: ['cut', 'colour', 'trim'],
    schedules: weekly(H(10), H(19)),
    ...extra,
  });
  return {
    branches: [{ id: 'b1', timezone: 'Asia/Kolkata', hours: allWeekHours }],
    services: [
      { id: 'cut', name: 'Haircut', basePricePaise: 60_000, baseDurationMin: 60 },
      { id: 'colour', name: 'Colour', basePricePaise: 350_000, baseDurationMin: 120 },
      { id: 'trim', name: 'Trim', basePricePaise: 30_000, baseDurationMin: 30 },
    ],
    branchServices: ['cut', 'colour', 'trim'].map((serviceId) => ({ branchId: 'b1', serviceId })),
    staff: [stylist('s1'), stylist('s2'), stylist('s3')],
    timeOff: [],
    appointments: [],
  };
}
