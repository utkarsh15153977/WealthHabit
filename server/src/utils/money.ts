import { Prisma } from '@prisma/client';

export const ZERO = new Prisma.Decimal(0);

export function roundMoney(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}

export function roundRate(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}
