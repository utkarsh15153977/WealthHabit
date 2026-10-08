import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { financialApi } from '../../services/financialApi';
import { getApiErrorMessage } from '../../services/error';
import type { Category } from '../../types/category';
import type { CategoryRule } from '../../types/financial';

const ruleSchema = z.object({
  merchant: z
    .string()
    .trim()
    .min(1, 'Merchant is required')
    .max(120, 'Merchant is too long'),
  categoryId: z.string().min(1, 'Category is required'),
  isActive: z.boolean(),
});

type RuleFormValues = z.infer<typeof ruleSchema>;

interface CategoryRuleFormProps {
  rule: CategoryRule | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

export function CategoryRuleForm({ rule, categories, onClose, onSaved }: CategoryRuleFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      merchant: rule?.merchant ?? '',
      categoryId: rule?.categoryId ?? '',
      isActive: rule?.isActive ?? true,
    },
  });

  const onSubmit = async (values: RuleFormValues) => {
    setServerError(null);

    try {
      if (rule) {
        await financialApi.updateCategoryRule(rule.id, {
          merchant: values.merchant,
          categoryId: values.categoryId,
          isActive: values.isActive,
        });
      } else {
        await financialApi.createCategoryRule({
          merchant: values.merchant,
          categoryId: values.categoryId,
          isActive: values.isActive,
        });
      }
      onSaved();
    } catch (error) {
      setServerError(getApiErrorMessage(error));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="presentation">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !isSubmitting && onClose()}
        aria-hidden="true"
      />
      <div
        className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-rule-form-title"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id="category-rule-form-title" className="heading-3">
            {rule ? 'Edit Merchant Rule' : 'Add Merchant Rule'}
          </h2>
          <button
            type="button"
            className="btn-ghost p-2"
            aria-label="Close dialog"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div>
            <label htmlFor="rule-merchant" className="label">
              Merchant
            </label>
            <input
              id="rule-merchant"
              type="text"
              className="input"
              placeholder="e.g. swiggy"
              autoComplete="off"
              {...register('merchant')}
              disabled={isSubmitting}
            />
            {errors.merchant && (
              <p className="text-error text-sm mt-1" role="alert">
                {errors.merchant.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="rule-category" className="label">
              Category
            </label>
            <select
              id="rule-category"
              className="input"
              {...register('categoryId')}
              disabled={isSubmitting}
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({category.type === 'INCOME' ? 'Income' : 'Expense'})
                </option>
              ))}
            </select>
            {errors.categoryId && (
              <p className="text-error text-sm mt-1" role="alert">
                {errors.categoryId.message}
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4"
                {...register('isActive')}
                disabled={isSubmitting}
              />
              <span>Active</span>
            </label>
          </div>

          {serverError && (
            <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error" role="alert">
              {serverError}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
