import { PrismaClient, CategoryType } from '@prisma/client';
import { prisma as sharedPrisma } from '../config/prisma.js';

export interface DefaultCategoryDefinition {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: DefaultCategoryDefinition[] = [
  { name: 'Salary', type: 'INCOME', icon: 'briefcase', color: '#10b981' },
  { name: 'Freelance', type: 'INCOME', icon: 'laptop', color: '#14b8a6' },
  { name: 'Business', type: 'INCOME', icon: 'building-2', color: '#0ea5e9' },
  { name: 'Investment Income', type: 'INCOME', icon: 'trending-up', color: '#22c55e' },
  { name: 'Other Income', type: 'INCOME', icon: 'circle-dollar-sign', color: '#84cc16' },
  { name: 'Food', type: 'EXPENSE', icon: 'utensils', color: '#f97316' },
  { name: 'Transportation', type: 'EXPENSE', icon: 'car', color: '#0ea5e9' },
  { name: 'Housing', type: 'EXPENSE', icon: 'home', color: '#8b5cf6' },
  { name: 'Utilities', type: 'EXPENSE', icon: 'zap', color: '#eab308' },
  { name: 'Healthcare', type: 'EXPENSE', icon: 'heart-pulse', color: '#ef4444' },
  { name: 'Shopping', type: 'EXPENSE', icon: 'shopping-bag', color: '#ec4899' },
  { name: 'Entertainment', type: 'EXPENSE', icon: 'film', color: '#a855f7' },
  { name: 'Education', type: 'EXPENSE', icon: 'graduation-cap', color: '#6366f1' },
  { name: 'Travel', type: 'EXPENSE', icon: 'plane', color: '#06b6d4' },
  { name: 'Other Expense', type: 'EXPENSE', icon: 'more-horizontal', color: '#64748b' },
];

export async function seedDefaultCategories(
  client: PrismaClient = sharedPrisma
): Promise<{
  created: number;
  existing: number;
}> {
  let created = 0;
  let existing = 0;

  for (const definition of DEFAULT_CATEGORIES) {
    const found = await client.category.findFirst({
      where: { userId: null, name: definition.name, type: definition.type },
      select: { id: true },
    });

    if (found) {
      existing += 1;
      continue;
    }

    await client.category.create({
      data: {
        userId: null,
        name: definition.name,
        type: definition.type,
        icon: definition.icon,
        color: definition.color,
        isDefault: true,
      },
    });
    created += 1;
  }

  return { created, existing };
}
