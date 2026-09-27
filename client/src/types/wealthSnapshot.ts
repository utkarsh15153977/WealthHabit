export interface WealthSnapshot {
  id: string;
  snapshotDate: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface WealthSnapshotListParams {
  page?: number;
  pageSize?: number;
}

export interface WealthSnapshotListResponse {
  snapshots: WealthSnapshot[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WealthSnapshotResponse {
  snapshot: WealthSnapshot;
  created: boolean;
}
