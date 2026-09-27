import { Prisma } from '@prisma/client';

export const ZERO = new Prisma.Decimal(0);

const HUNDRED = new Prisma.Decimal(100);

export function roundMoney(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}

export function roundRate(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}

/**
 * The single goal-progress algorithm used by both the Goals API and Wealth
 * Analytics: saved / target * 100, Decimal-safe, capped at 100 and rounded to
 * 2 places. A target of zero (or less) reports 0 instead of dividing by zero.
 */
export function goalProgressValues(
  saved: Prisma.Decimal,
  target: Prisma.Decimal
): {
  remainingAmount: Prisma.Decimal;
  progressPercent: number;
} {
  const remaining = target.minus(saved);
  const remainingAmount = remaining.isNegative() ? ZERO : remaining;
  let percent = target.lte(ZERO) ? ZERO : saved.div(target).times(HUNDRED);
  if (percent.gt(HUNDRED)) {
    percent = HUNDRED;
  }
  return { remainingAmount, progressPercent: roundRate(percent) };
}
