import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CreditCard,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Scale,
  Settings,
  Target,
  Trash2,
  FileText,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { getMyProfile } from '../services/userApi';
import { assetLiabilityApi } from '../services/assetLiabilityApi';
import {
  ASSET_TYPES,
  LIABILITY_TYPES,
} from '../types/assetLiability';
import type {
  Asset,
  AssetType,
  AssetsLiabilitiesSummary,
  Liability,
  LiabilityType,
} from '../types/assetLiability';

const PAGE_SIZE = 50;

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const MONEY_MAX = 9999999999999.99;

type RecordKind = 'ASSET' | 'LIABILITY';

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  CASH: 'Cash',
  BANK_ACCOUNT: 'Bank account',
  FIXED_DEPOSIT: 'Fixed deposit',
  PROPERTY: 'Property',
  VEHICLE: 'Vehicle',
  GOLD: 'Gold',
  INVESTMENT: 'Investment',
  OTHER: 'Other',
};

const LIABILITY_TYPE_LABELS: Record<LiabilityType, string> = {
  CREDIT_CARD: 'Credit card',
  PERSONAL_LOAN: 'Personal loan',
  HOME_LOAN: 'Home loan',
  VEHICLE_LOAN: 'Vehicle loan',
  EDUCATION_LOAN: 'Education loan',
  OTHER: 'Other',
};

const LIABILITY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  PAID_OFF: 'Paid off',
};

const recordFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    type: z.string().min(1, 'Type is required'),
    value: z
      .string()
      .trim()
      .min(1, 'Amount is required')
      .regex(MONEY_PATTERN, 'Amount must be a number with up to 2 decimal places')
      .refine((value) => Number(value) <= MONEY_MAX, 'Amount exceeds the maximum allowed value'),
    notes: z
      .string()
      .trim()
      .max(1000, 'Notes must be at most 1000 characters')
      .optional(),
  })
  .strict();

type RecordForm = z.infer<typeof recordFormSchema>;

function createCurrencyFormatter(currency: string | null): (amount: number) => string {
  return (amount: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency ?? 'USD',
      }).format(amount);
    } catch {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
      }).format(amount);
    }
  };
}

function emptyRecordForm(kind: RecordKind): RecordForm {
  return {
    name: '',
    type: kind === 'ASSET' ? 'BANK_ACCOUNT' : 'CREDIT_CARD',
    value: '',
    notes: '',
  };
}

export function AssetsLiabilities() {
  const { user, logout } = useAuth();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [summary, setSummary] = useState<AssetsLiabilitiesSummary | null>(null);
  const [assetTotal, setAssetTotal] = useState(0);
  const [liabilityTotal, setLiabilityTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<RecordKind>('ASSET');
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editingLiability, setEditingLiability] = useState<Liability | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: RecordKind; id: string; name: string } | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RecordForm>({
    resolver: zodResolver(recordFormSchema),
    defaultValues: emptyRecordForm('ASSET'),
  });

  const formatAmount = useMemo(() => createCurrencyFormatter(currency), [currency]);

  const fetchProfileCurrency = useCallback(async () => {
    try {
      const result = await getMyProfile();
      setCurrency(result.profile.financialProfile.currency);
    } catch {
      setCurrency(null);
    }
  }, []);

  const hasLoadedOnceRef = useRef(false);

  const fetchAll = useCallback(async (options: { initial?: boolean } = {}) => {
    const { initial = false } = options;

    if (initial) {
      setIsLoading(true);
    }
    setLoadError(null);

    try {
      const [assetResult, liabilityResult, summaryResult] = await Promise.all([
        assetLiabilityApi.getAssets({ pageSize: PAGE_SIZE }),
        assetLiabilityApi.getLiabilities({ pageSize: PAGE_SIZE }),
        assetLiabilityApi.getAssetsLiabilitiesSummary(),
      ]);
      setAssets(assetResult.assets);
      setAssetTotal(assetResult.total);
      setLiabilities(liabilityResult.liabilities);
      setLiabilityTotal(liabilityResult.total);
      setSummary(summaryResult);
      setHasLoadedOnce(true);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (initial || hasLoadedOnceRef.current) {
        setAssets([]);
        setLiabilities([]);
        setSummary(null);
        setLoadError(getApiErrorMessage(error));
      }
    } finally {
      if (initial) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchProfileCurrency();
  }, [fetchProfileCurrency]);

  useEffect(() => {
    void fetchAll({ initial: !hasLoadedOnceRef.current });
  }, [fetchAll]);

  const openCreateForm = useCallback(
    (kind: RecordKind) => {
      setFormKind(kind);
      setEditingAsset(null);
      setEditingLiability(null);
      setActionError(null);
      reset(emptyRecordForm(kind));
      setIsFormOpen(true);
    },
    [reset]
  );

  const openEditAsset = useCallback(
    (asset: Asset) => {
      setFormKind('ASSET');
      setEditingAsset(asset);
      setEditingLiability(null);
      setActionError(null);
      reset({
        name: asset.name,
        type: asset.type,
        value: String(asset.currentValue),
        notes: asset.notes ?? '',
      });
      setIsFormOpen(true);
    },
    [reset]
  );

  const openEditLiability = useCallback(
    (liability: Liability) => {
      setFormKind('LIABILITY');
      setEditingAsset(null);
      setEditingLiability(liability);
      setActionError(null);
      reset({
        name: liability.name,
        type: liability.type,
        value: String(liability.outstandingAmount),
        notes: liability.notes ?? '',
      });
      setIsFormOpen(true);
    },
    [reset]
  );

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingAsset(null);
    setEditingLiability(null);
    setActionError(null);
    reset(emptyRecordForm('ASSET'));
  }, [reset]);

  const onSubmit = useCallback(
    async (form: RecordForm) => {
      setActionError(null);
      const notes = form.notes?.trim() ? form.notes : undefined;

      try {
        if (editingAsset) {
          await assetLiabilityApi.updateAsset(editingAsset.id, {
            name: form.name,
            type: form.type as AssetType,
            currentValue: form.value,
            notes: notes ?? null,
          });
          setSuccessMessage(`Asset "${form.name}" updated`);
        } else if (editingLiability) {
          await assetLiabilityApi.updateLiability(editingLiability.id, {
            name: form.name,
            type: form.type as LiabilityType,
            outstandingAmount: form.value,
            notes: notes ?? null,
          });
          setSuccessMessage(`Liability "${form.name}" updated`);
        } else if (formKind === 'ASSET') {
          await assetLiabilityApi.createAsset({
            name: form.name,
            type: form.type as AssetType,
            currentValue: form.value,
            notes,
          });
          setSuccessMessage(`Asset "${form.name}" created`);
        } else {
          await assetLiabilityApi.createLiability({
            name: form.name,
            type: form.type as LiabilityType,
            outstandingAmount: form.value,
            notes,
          });
          setSuccessMessage(`Liability "${form.name}" created`);
        }

        closeForm();
        await fetchAll();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      }
    },
    [editingAsset, editingLiability, formKind, closeForm, fetchAll]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setActionError(null);

    try {
      if (deleteTarget.kind === 'ASSET') {
        await assetLiabilityApi.deleteAsset(deleteTarget.id);
      } else {
        await assetLiabilityApi.deleteLiability(deleteTarget.id);
      }
      setDeleteTarget(null);
      setSuccessMessage(
        `${deleteTarget.kind === 'ASSET' ? 'Asset' : 'Liability'} "${deleteTarget.name}" deleted`
      );
      await fetchAll();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, fetchAll]);

  const typeOptions =
    formKind === 'ASSET'
      ? ASSET_TYPES.map((value) => ({ value, label: ASSET_TYPE_LABELS[value] }))
      : LIABILITY_TYPES.map((value) => ({
          value,
          label: LIABILITY_TYPE_LABELS[value],
        }));

  const showEmpty =
    hasLoadedOnce && !isLoading && !loadError && assets.length === 0 && liabilities.length === 0;

  const renderAssetCard = (asset: Asset) => (
    <div key={asset.id} className="card" data-testid={`asset-card-${asset.name}`}>
      <div className="card-body">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="heading-4 truncate">{asset.name}</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {ASSET_TYPE_LABELS[asset.type]}
            </p>
          </div>
          <span className="badge flex-shrink-0" data-testid={`asset-status-${asset.name}`}>
            {asset.status === 'ACTIVE' ? 'Active' : asset.status}
          </span>
        </div>

        {asset.notes && <p className="text-sm text-text-muted mb-3">{asset.notes}</p>}

        <div className="rounded-lg border border-border px-3 py-2 mb-4">
          <p className="text-xs text-text-muted">Current value</p>
          <p
            className="text-lg font-medium text-text"
            data-testid={`asset-value-${asset.name}`}
          >
            {formatAmount(asset.currentValue)}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <button
            type="button"
            className="btn-ghost btn-sm text-error hover:bg-red-50"
            aria-label={`Delete asset ${asset.name}`}
            onClick={() => {
              setActionError(null);
              setDeleteTarget({ kind: 'ASSET', id: asset.id, name: asset.name });
            }}
            data-testid={`asset-delete-${asset.name}`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            aria-label={`Edit asset ${asset.name}`}
            onClick={() => openEditAsset(asset)}
            data-testid={`asset-edit-${asset.name}`}
          >
            <Pencil className="w-4 h-4" aria-hidden="true" />
            Edit
          </button>
        </div>
      </div>
    </div>
  );

  const renderLiabilityCard = (liability: Liability) => (
    <div
      key={liability.id}
      className="card"
      data-testid={`liability-card-${liability.name}`}
    >
      <div className="card-body">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="heading-4 truncate">{liability.name}</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {LIABILITY_TYPE_LABELS[liability.type]}
            </p>
          </div>
          <span
            className={`badge flex-shrink-0 ${
              liability.status === 'PAID_OFF' ? 'badge-success' : ''
            }`}
            data-testid={`liability-status-${liability.name}`}
          >
            {LIABILITY_STATUS_LABELS[liability.status] ?? liability.status}
          </span>
        </div>

        {liability.notes && (
          <p className="text-sm text-text-muted mb-3">{liability.notes}</p>
        )}

        <div className="rounded-lg border border-border px-3 py-2 mb-4">
          <p className="text-xs text-text-muted">Outstanding balance</p>
          <p
            className="text-lg font-medium text-text"
            data-testid={`liability-value-${liability.name}`}
          >
            {formatAmount(liability.outstandingAmount)}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <button
            type="button"
            className="btn-ghost btn-sm text-error hover:bg-red-50"
            aria-label={`Delete liability ${liability.name}`}
            onClick={() => {
              setActionError(null);
              setDeleteTarget({
                kind: 'LIABILITY',
                id: liability.id,
                name: liability.name,
              });
            }}
            data-testid={`liability-delete-${liability.name}`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            aria-label={`Edit liability ${liability.name}`}
            onClick={() => openEditLiability(liability)}
            data-testid={`liability-edit-${liability.name}`}
          >
            <Pencil className="w-4 h-4" aria-hidden="true" />
            Edit
          </button>
        </div>
      </div>
    </div>
  );

  if (isLoading && !hasLoadedOnce) {
    return <Loading />;
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: false },
    { name: 'Challenges', href: '/challenges', icon: Trophy, current: false },
    { name: 'Goals', href: '/goals', icon: PiggyBank, current: false },
    { name: 'Assets & Liabilities', href: '/assets-liabilities', icon: Landmark, current: true },
    { name: 'Net Worth', href: '/net-worth', icon: Scale, current: false },
    { name: 'Wealth Analytics', href: '/wealth-analytics', icon: TrendingUp, current: false },
    { name: 'Reports', href: '/reports', icon: FileText, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  return (
    <div className="page-container">
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path
                d="M8 16L14 22L24 10"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-xl font-bold text-text">WealthHabit</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  item.current
                    ? 'bg-primary-light text-primary'
                    : 'text-text-muted hover:bg-background hover:text-text'
                }`}
                aria-current={item.current ? 'page' : undefined}
              >
                <item.icon className="w-4 h-4 inline mr-2" aria-hidden="true" />
                {item.name}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-text-muted">
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </span>
            <NotificationBell />
            <button
              type="button"
              className="btn-ghost p-2"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1 flex items-center gap-2">
              <Landmark className="w-6 h-6" aria-hidden="true" />
              Assets &amp; Liabilities
            </h1>
            <p className="text-text-muted mt-1">
              Track what you own and what you owe. Records here are independent — they never
              create transactions and never touch your budgets or goals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openCreateForm('ASSET')}
              data-testid="create-asset-button"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New asset
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => openCreateForm('LIABILITY')}
              data-testid="create-liability-button"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New liability
            </button>
          </div>
        </div>

        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8"
          data-testid="assets-liabilities-summary"
        >
          <div className="card">
            <div className="card-body flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0">
                <Landmark className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-text-muted">Total assets</p>
                <p className="text-xl font-semibold text-text" data-testid="summary-total-assets">
                  {summary ? formatAmount(summary.totalAssets) : '—'}
                </p>
                <p className="text-xs text-text-muted" data-testid="summary-asset-count">
                  {summary ? `${summary.assetCount} assets` : ''}
                </p>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-body flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-text-muted">Total liabilities</p>
                <p
                  className="text-xl font-semibold text-text"
                  data-testid="summary-total-liabilities"
                >
                  {summary ? formatAmount(summary.totalLiabilities) : '—'}
                </p>
                <p className="text-xs text-text-muted" data-testid="summary-liability-count">
                  {summary ? `${summary.liabilityCount} liabilities` : ''}
                </p>
              </div>
            </div>
          </div>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-success mb-6"
            role="status"
            data-testid="assets-liabilities-success"
          >
            {successMessage}
          </div>
        )}

        {actionError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
            data-testid="assets-liabilities-error"
          >
            {actionError}
          </div>
        )}

        {loadError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span>{loadError}</span>
              <button
                type="button"
                className="btn-secondary btn-sm self-start sm:self-auto"
                onClick={() => void fetchAll({ initial: true })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showEmpty && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <Landmark className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No assets or liabilities yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Add your bank accounts, cash, property, and investments on one side — and your
                loans and credit cards on the other.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openCreateForm('ASSET')}
                  data-testid="assets-empty-create-asset"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add an asset
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => openCreateForm('LIABILITY')}
                  data-testid="assets-empty-create-liability"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add a liability
                </button>
              </div>
            </div>
          </div>
        )}

        {!loadError && (assets.length > 0 || liabilities.length > 0) && (
          <>
            <section aria-labelledby="assets-heading" className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 id="assets-heading" className="heading-3">
                  Assets
                </h2>
                <span className="text-sm text-text-muted" data-testid="assets-count">
                  {assetTotal} total
                </span>
              </div>
              {assets.length === 0 ? (
                <div className="card">
                  <div className="card-body text-center py-10">
                    <p className="text-sm text-text-muted mb-4">
                      No assets yet. Add what you own to see your total assets here.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => openCreateForm('ASSET')}
                      data-testid="assets-section-create"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Add an asset
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {assets.map(renderAssetCard)}
                </div>
              )}
              {assetTotal > assets.length && (
                <p className="text-xs text-text-muted mt-3">
                  Showing the {assets.length} most recent of {assetTotal} assets.
                </p>
              )}
            </section>

            <section aria-labelledby="liabilities-heading" className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 id="liabilities-heading" className="heading-3">
                  Liabilities
                </h2>
                <span className="text-sm text-text-muted" data-testid="liabilities-count">
                  {liabilityTotal} total
                </span>
              </div>
              {liabilities.length === 0 ? (
                <div className="card">
                  <div className="card-body text-center py-10">
                    <p className="text-sm text-text-muted mb-4">
                      No liabilities yet. Add loans and credit cards to track what you owe.
                    </p>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => openCreateForm('LIABILITY')}
                      data-testid="liabilities-section-create"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Add a liability
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {liabilities.map(renderLiabilityCard)}
                </div>
              )}
              {liabilityTotal > liabilities.length && (
                <p className="text-xs text-text-muted mt-3">
                  Showing the {liabilities.length} most recent of {liabilityTotal} liabilities.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isSubmitting && closeForm()}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-lg bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-liability-form-title"
            data-testid="asset-liability-form"
          >
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 id="asset-liability-form-title" className="heading-3">
                {editingAsset
                  ? 'Edit asset'
                  : editingLiability
                    ? 'Edit liability'
                    : formKind === 'ASSET'
                      ? 'New asset'
                      : 'New liability'}
              </h2>
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label="Close form"
                onClick={closeForm}
                disabled={isSubmitting}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                {actionError && (
                  <div
                    className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error"
                    role="alert"
                    data-testid="asset-liability-form-error"
                  >
                    {actionError}
                  </div>
                )}

                <div>
                  <label htmlFor="record-name" className="label">
                    Name
                  </label>
                  <input
                    id="record-name"
                    type="text"
                    placeholder={
                      formKind === 'ASSET' ? 'e.g. Savings account' : 'e.g. Credit card'
                    }
                    className={`input ${errors.name ? 'input-error' : ''}`}
                    {...register('name')}
                    aria-invalid={errors.name ? 'true' : 'false'}
                    aria-describedby={errors.name ? 'record-name-error' : undefined}
                    data-testid="record-name-input"
                  />
                  {errors.name && (
                    <p id="record-name-error" className="mt-1.5 text-sm text-error" role="alert">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="record-type" className="label">
                      Type
                    </label>
                    <select
                      id="record-type"
                      className="input"
                      {...register('type')}
                      data-testid="record-type-select"
                    >
                      {typeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {errors.type && (
                      <p className="mt-1.5 text-sm text-error" role="alert">
                        {errors.type.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="record-value" className="label">
                      {formKind === 'ASSET' ? 'Current value' : 'Outstanding balance'}
                    </label>
                    <input
                      id="record-value"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`input ${errors.value ? 'input-error' : ''}`}
                      {...register('value')}
                      aria-invalid={errors.value ? 'true' : 'false'}
                      aria-describedby={errors.value ? 'record-value-error' : undefined}
                      data-testid="record-value-input"
                    />
                    {errors.value && (
                      <p
                        id="record-value-error"
                        className="mt-1.5 text-sm text-error"
                        role="alert"
                      >
                        {errors.value.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="record-notes" className="label">
                    Notes
                  </label>
                  <textarea
                    id="record-notes"
                    rows={2}
                    placeholder="Optional"
                    className={`input ${errors.notes ? 'input-error' : ''}`}
                    {...register('notes')}
                    aria-invalid={errors.notes ? 'true' : 'false'}
                    data-testid="record-notes-input"
                  />
                  {errors.notes && (
                    <p className="mt-1.5 text-sm text-error" role="alert">
                      {errors.notes.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeForm}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isSubmitting}
                    data-testid="record-submit"
                  >
                    {isSubmitting
                      ? 'Saving...'
                      : editingAsset || editingLiability
                        ? 'Save changes'
                        : formKind === 'ASSET'
                          ? 'Create asset'
                          : 'Create liability'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isDeleting && setDeleteTarget(null)}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-record-title"
            aria-describedby="delete-record-description"
            data-testid="delete-record-modal"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="delete-record-title" className="heading-3">
                Delete {deleteTarget.kind === 'ASSET' ? 'asset' : 'liability'}?
              </h2>
            </div>
            <p id="delete-record-description" className="text-sm text-text-muted mb-6">
              This permanently removes{' '}
              <span className="font-medium text-text">{deleteTarget.name}</span> from your{' '}
              {deleteTarget.kind === 'ASSET' ? 'assets' : 'liabilities'}. Your transactions,
              budgets, and goals are not affected.
            </p>
            {actionError && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
                role="alert"
              >
                {actionError}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void confirmDelete()}
                disabled={isDeleting}
                data-testid="delete-record-confirm"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
