import { AlertTriangle, CheckCircle2, Link2Off, Unplug } from 'lucide-react';
import type { FinancialConnectionStatus } from '../../types/financial';

const STATUS_CONFIG: Record<
  FinancialConnectionStatus,
  { label: string; badge: string; icon: typeof CheckCircle2 }
> = {
  ACTIVE: { label: 'Active', badge: 'badge badge-success', icon: CheckCircle2 },
  ERROR: { label: 'Error', badge: 'badge badge-error', icon: AlertTriangle },
  REVOKED: { label: 'Revoked', badge: 'badge badge-warning', icon: Link2Off },
  DISCONNECTED: { label: 'Disconnected', badge: 'badge badge-info', icon: Unplug },
};

interface SyncStatusProps {
  status: FinancialConnectionStatus;
}

export function SyncStatus({ status }: SyncStatusProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.DISCONNECTED;
  const Icon = config.icon;

  return (
    <span className={config.badge}>
      <Icon className="w-3 h-3 mr-1 inline-block" aria-hidden="true" />
      {config.label}
    </span>
  );
}
