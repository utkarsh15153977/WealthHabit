import { CategoryType } from '@prisma/client';

export interface TransactionCategoryRuleCategorySummary {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
}

export interface TransactionCategoryRuleData {
  id: string;
  merchant: string;
  categoryId: string;
  category: TransactionCategoryRuleCategorySummary;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionCategoryRuleListData {
  rules: TransactionCategoryRuleData[];
}
