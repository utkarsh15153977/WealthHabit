import { Prisma, Category, CategoryType } from '@prisma/client';
import { CreateCategoryInput, UpdateCategoryInput } from '../schemas/categorySchemas.js';
import { prisma } from '../config/prisma.js';

export async function listUserCategories(
  userId: string,
  type?: CategoryType
): Promise<Category[]> {
  return prisma.category.findMany({
    where: {
      AND: [
        { OR: [{ userId }, { userId: null }] },
        ...(type ? [{ type }] : []),
      ],
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

export async function findCategoryById(id: string): Promise<Category | null> {
  return prisma.category.findUnique({ where: { id } });
}

export async function findDuplicateCategory(
  userId: string,
  name: string
): Promise<Category | null> {
  return prisma.category.findFirst({
    where: {
      userId,
      name: { equals: name, mode: 'insensitive' },
    },
  });
}

export async function createCategory(
  userId: string,
  input: CreateCategoryInput
): Promise<Category> {
  return prisma.category.create({
    data: {
      userId,
      name: input.name,
      type: input.type,
      icon: input.icon ?? null,
      color: input.color ?? null,
      isDefault: false,
    },
  });
}

export async function updateCategory(
  categoryId: string,
  input: UpdateCategoryInput
): Promise<Category> {
  const data: Prisma.CategoryUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.color !== undefined) data.color = input.color;

  return prisma.category.update({
    where: { id: categoryId },
    data,
  });
}

export async function countCategoryTransactions(categoryId: string): Promise<number> {
  return prisma.transaction.count({
    where: { categoryId },
  });
}

export async function deleteCategory(categoryId: string): Promise<void> {
  await prisma.category.delete({
    where: { id: categoryId },
  });
}

export function isSystemCategory(category: Category): boolean {
  return category.userId === null || category.isDefault;
}

export function isOwnCategory(category: Category, userId: string): boolean {
  return category.userId === userId && !category.isDefault;
}
