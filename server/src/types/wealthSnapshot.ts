export interface WealthSnapshotData {
  id: string;
  snapshotDate: Date;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface WealthSnapshotListData {
  snapshots: WealthSnapshotData[];
  page: number;
  pageSize: number;
  total: number;
}
