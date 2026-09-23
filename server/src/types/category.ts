import { CategoryType } from '@prisma/client';

export interface CategoryData {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryListData {
  categories: CategoryData[];
}
