export const ASSET_TYPES = [
  'CASH',
  'BANK_ACCOUNT',
  'FIXED_DEPOSIT',
  'PROPERTY',
  'VEHICLE',
  'GOLD',
  'INVESTMENT',
  'OTHER',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export const LIABILITY_TYPES = [
  'CREDIT_CARD',
  'PERSONAL_LOAN',
  'HOME_LOAN',
  'VEHICLE_LOAN',
  'EDUCATION_LOAN',
  'OTHER',
] as const;

export type LiabilityType = (typeof LIABILITY_TYPES)[number];

/**
 * Both statuses are derived at serialization time from the stored row.
 * Neither model has a persisted status column and Phase 5B adds none.
 */
export type AssetStatus = 'ACTIVE';

/**
 * ACTIVE while an outstanding balance remains, PAID_OFF once it reaches 0.
 */
export type LiabilityStatus = 'ACTIVE' | 'PAID_OFF';

export interface AssetData {
  id: string;
  name: string;
  type: AssetType;
  currentValue: number;
  notes: string | null;
  status: AssetStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface LiabilityData {
  id: string;
  name: string;
  type: LiabilityType;
  outstandingAmount: number;
  notes: string | null;
  status: LiabilityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetListData {
  assets: AssetData[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LiabilityListData {
  liabilities: LiabilityData[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AssetsLiabilitiesSummaryData {
  totalAssets: number;
  totalLiabilities: number;
  assetCount: number;
  liabilityCount: number;
}
