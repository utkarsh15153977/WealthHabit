export type CategoryType = 'INCOME' | 'EXPENSE';

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryListResponse {
  categories: Category[];
}

export interface CategoryResponse {
  category: Category;
}

export interface CategoryListParams {
  type?: CategoryType;
}

export interface CreateCategoryRequest {
  name: string;
  type: CategoryType;
  icon?: string | null;
  color?: string | null;
}

export interface UpdateCategoryRequest {
  name?: string;
  icon?: string | null;
  color?: string | null;
}
