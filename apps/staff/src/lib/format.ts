/** Money is stored as integer paise and shown with Indian digit grouping. */
export function formatPrice(paise: number): string {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(paise / 100);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** `+919876543210` -> `+91 98765 43210`. Other numbers are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export const telHref = (e164: string) => `tel:${e164}`;

/** "WALK_IN" -> "Walk-in" */
export const SOURCE_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
};

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  BRANCH_MANAGER: 'Branch manager',
  RECEPTIONIST: 'Receptionist',
  STYLIST: 'Stylist',
};
