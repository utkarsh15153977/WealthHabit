import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { CategoryRuleForm } from './CategoryRuleForm';
import { ConfirmDialog } from './ConfirmDialog';
import { financialApi } from '../../services/financialApi';
import { getCategories } from '../../services/categoryApi';
import { getApiErrorMessage } from '../../services/error';
import type { Category } from '../../types/category';
import type { CategoryRule } from '../../types/financial';

export function CategoryRuleManager() {
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CategoryRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [ruleList, categoryList] = await Promise.all([
        financialApi.listCategoryRules(),
        getCategories(),
      ]);
      setRules(ruleList);
      setCategories(categoryList.categories);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      await financialApi.deleteCategoryRule(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage('Rule deleted');
      await fetchRules();
    } catch (error) {
      setDeleteError(getApiErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section aria-labelledby="category-rules-heading" className="card">
      <div className="card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 id="category-rules-heading" className="heading-3">
            Transaction Category Rules
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Rules are created when you choose Remember while recategorizing. Merchants are
            stored as normalized keys, never raw descriptions.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary btn-sm self-start sm:self-auto"
          onClick={() => {
            setEditingRule(null);
            setIsFormOpen(true);
          }}
          aria-label="Add merchant rule"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add rule
        </button>
      </div>

      <div className="card-body">
        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-green-700 mb-4"
            role="status"
          >
            {successMessage}
          </div>
        )}

        {isLoading && <p className="text-sm text-text-muted">Loading rules...</p>}

        {!isLoading && loadError && (
          <div className="mb-4">
            <div
              className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
              role="alert"
            >
              {loadError}
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm mt-3"
              onClick={() => void fetchRules()}
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !loadError && rules.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center">
            <p className="text-sm font-medium text-text mb-1">No merchant rules yet.</p>
            <p className="text-sm text-text-muted">
              Create a rule when you want a merchant to always use a particular category.
            </p>
          </div>
        )}

        {!isLoading && !loadError && rules.length > 0 && (
          <ul className="divide-y divide-border">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text truncate">{rule.merchant}</p>
                  <p className="text-xs text-text-muted truncate">{rule.category.name}</p>
                </div>

                <span
                  className={
                    rule.isActive ? 'badge badge-success self-start' : 'badge badge-info self-start'
                  }
                >
                  {rule.isActive ? 'Active' : 'Inactive'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setEditingRule(rule);
                      setIsFormOpen(true);
                    }}
                    aria-label={`Edit rule for ${rule.merchant}`}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-error hover:bg-red-50"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(rule);
                    }}
                    aria-label={`Delete rule for ${rule.merchant}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isFormOpen && (
        <CategoryRuleForm
          rule={editingRule}
          categories={categories}
          onClose={() => setIsFormOpen(false)}
          onSaved={() => {
            setIsFormOpen(false);
            setSuccessMessage('Rule saved');
            void fetchRules();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this merchant rule?"
          description={`Future imported ${deleteTarget.merchant} transactions will no longer use this category automatically.`}
          confirmLabel="Delete"
          danger
          isPending={isDeleting}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </section>
  );
}
