export { bookingConfig, resolveConfig } from './config';
export type { BookingConfig } from './config';
export { getAvailableSlots } from './slots';
export { createAppointment } from './create';
export { normalizePhone } from './phone';
export { SlotTakenError } from './types';
export type {
  AppointmentItemSnapshot,
  AppointmentSource,
  BookingPort,
  BookingTx,
  BranchRecord,
  BusyInterval,
  CreateInput,
  CreatedAppointment,
  CreateResult,
  EngineOptions,
  Failure,
  FailureReason,
  NewAppointment,
  ScheduleRow,
  ServiceRecord,
  Slot,
  SlotsInput,
  SlotsResult,
  StaffRecord,
  StylistPreference,
} from './types';
