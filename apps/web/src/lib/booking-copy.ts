import { bookingConfig } from '@salon/booking/config';

/**
 * What a customer reads when the booking API refuses. The API returns a stable reason code; this is
 * the only place that turns it into words. Never shows technical detail.
 */
export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PHONE'
  | 'BRANCH_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'STYLIST_NOT_ELIGIBLE'
  | 'OUTSIDE_BOOKING_WINDOW'
  | 'TOO_SOON'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_TAKEN'
  | 'PHONE_LIMIT_REACHED'
  | 'CAPTCHA_FAILED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'SERVER_ERROR';

export function errorMessage(code: string | undefined, branchPhone?: string): string {
  const call = branchPhone ? ` or call us on ${branchPhone}` : ' or call the branch';
  switch (code) {
    case 'SLOT_TAKEN':
    case 'SLOT_UNAVAILABLE':
      return 'Sorry, that time has just been taken. Please choose another time.';
    case 'TOO_SOON':
      return 'That time is too soon to book online. Please choose a later time.';
    case 'OUTSIDE_BOOKING_WINDOW':
      return `You can book up to ${bookingConfig.windowDays} days ahead. Please choose an earlier date.`;
    case 'INVALID_PHONE':
      return 'That mobile number does not look right. Please check it and try again.';
    case 'PHONE_LIMIT_REACHED':
      return `This number already has ${bookingConfig.maxUpcomingPerPhone} upcoming bookings online. To book more, please call the branch.`;
    case 'STYLIST_NOT_ELIGIBLE':
    case 'SERVICE_UNAVAILABLE':
    case 'BRANCH_NOT_FOUND':
      return `Those choices are no longer available. Please start again${call}.`;
    case 'CAPTCHA_FAILED':
      return 'We could not confirm you are not a robot. Please try again.';
    case 'RATE_LIMITED':
      return `Too many attempts. Please wait a minute and try again${call}.`;
    case 'INVALID_INPUT':
      return 'Some details look wrong. Please check them and try again.';
    default:
      return `Something went wrong on our side. Please try again${call}.`;
  }
}
