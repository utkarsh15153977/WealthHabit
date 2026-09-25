import { BillStatus, SubscriptionStatus } from '@prisma/client';
import { startOfUtcDay } from './date.js';

export type ObligationDueState = 'UPCOMING' | 'DUE' | 'OVERDUE' | null;

function classify(nextDate: Date, today: Date): 'UPCOMING' | 'DUE' | 'OVERDUE' {
  const due = startOfUtcDay(nextDate).getTime();
  const now = startOfUtcDay(today).getTime();

  if (due > now) return 'UPCOMING';
  if (due === now) return 'DUE';
  return 'OVERDUE';
}

/**
 * Derived, never persisted: a bill is CANCELLED only when stored as such;
 * otherwise the stored status does not move it through UPCOMING/DUE/OVERDUE —
 * only the date does, and a past date never marks anything paid.
 */
export function billDueState(
  status: BillStatus,
  nextDueDate: Date,
  today: Date
): ObligationDueState {
  if (status === 'CANCELLED') {
    return null;
  }
  return classify(nextDueDate, today);
}

export function subscriptionDueState(
  status: SubscriptionStatus,
  nextRenewalDate: Date,
  today: Date
): ObligationDueState {
  if (status === 'CANCELLED' || status === 'PAUSED' || status === 'EXPIRED') {
    return null;
  }
  return classify(nextRenewalDate, today);
}
