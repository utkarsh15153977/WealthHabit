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

export type AssetStatus = 'ACTIVE';

export type LiabilityStatus = 'ACTIVE' | 'PAID_OFF';

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  currentValue: number;
  notes: string | null;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Liability {
  id: string;
  name: string;
  type: LiabilityType;
  outstandingAmount: number;
  notes: string | null;
  status: LiabilityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AssetListParams {
  page?: number;
  pageSize?: number;
  type?: AssetType;
}

export interface AssetListResponse {
  assets: Asset[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LiabilityListParams {
  page?: number;
  pageSize?: number;
  type?: LiabilityType;
}

export interface LiabilityListResponse {
  liabilities: Liability[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AssetsLiabilitiesSummary {
  totalAssets: number;
  totalLiabilities: number;
  assetCount: number;
  liabilityCount: number;
}

export interface AssetResponse {
  asset: Asset;
}

export interface LiabilityResponse {
  liability: Liability;
}

export interface CreateAssetRequest {
  name: string;
  currentValue: string;
  type?: AssetType;
  notes?: string;
}

export interface UpdateAssetRequest {
  name?: string;
  currentValue?: string;
  type?: AssetType;
  notes?: string | null;
}

export interface CreateLiabilityRequest {
  name: string;
  outstandingAmount: string;
  type?: LiabilityType;
  notes?: string;
}

export interface UpdateLiabilityRequest {
  name?: string;
  outstandingAmount?: string;
  type?: LiabilityType;
  notes?: string | null;
}
