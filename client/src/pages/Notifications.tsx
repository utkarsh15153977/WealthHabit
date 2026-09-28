import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  ListChecks,
  Receipt,
  RefreshCw,
  Repeat,
  Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { notificationApi } from '../services/notificationApi';
import { formatDate, toDateInputValue } from '../utils/date';
import type { Notification, NotificationType } from '../types/notification';

const PAGE_SIZE = 20;

const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  BUDGET_THRESHOLD: Target,
  BILL_UPCOMING: Receipt,
  BILL_OVERDUE: Receipt,
  SUBSCRIPTION_UPCOMING: RefreshCw,
  RECURRING_TRANSACTION_UPCOMING: Repeat,
  HABIT_REMINDER: ListChecks,
};

function createdAtLabel(iso: string): string {
  const day = toDateInputValue(iso);
  const todayIso = new Date().toISOString().slice(0, 10);
  if (day === todayIso) return 'Today';
  return formatDate(iso);
}

export function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const fetchNotifications = useCallback(
    async (options: { initial?: boolean } = {}) => {
      const { initial = false } = options;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        if (initial) {
          try {
            await notificationApi.generateNotifications();
          } catch {
            // Generation is best-effort; still show existing notifications.
          }
        }

        const result = await notificationApi.getNotifications({
          page,
          pageSize: PAGE_SIZE,
          unreadOnly: unreadOnly ? true : undefined,
        });
        setNotifications(result.items);
        setTotal(result.total);
        setUnreadCount(result.unreadCount);
        hasLoadedOnceRef.current = true;
      } catch (error) {
        if (initial || hasLoadedOnceRef.current) {
          setLoadError(getApiErrorMessage(error));
        }
      } finally {
        if (initial) {
          setIsLoading(false);
        } else {
          setIsFetching(false);
        }
      }
    },
    [page, unreadOnly]
  );

  useEffect(() => {
    void fetchNotifications({ initial: !hasLoadedOnceRef.current });
  }, [fetchNotifications]);

  const handleMarkRead = useCallback(
    async (notification: Notification) => {
      if (notification.isRead) return;
      setActionError(null);
      try {
        await notificationApi.markNotificationRead(notification.id);
        await fetchNotifications();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      }
    },
    [fetchNotifications]
  );

  const handleMarkAllRead = useCallback(async () => {
    setActionError(null);
    setIsMarkingAll(true);
    try {
      await notificationApi.markAllNotificationsRead();
      await fetchNotifications();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsMarkingAll(false);
    }
  }, [fetchNotifications]);

  const handleToggleUnreadOnly = useCallback(() => {
    setPage(1);
    setUnreadOnly((value) => !value);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (isLoading) {
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  }

  return (
    <div className="page-container">
      <main className="page-content">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="heading-1 flex items-center gap-2">
              <Bell className="w-6 h-6" aria-hidden="true" />
              Notifications
            </h1>
            <p className="text-text-muted mt-1" data-testid="unread-count">
              {unreadCount > 0 ? `${unreadCount} unread` : 'No unread notifications'}
            </p>
          </div>
          <div className="flex items-end gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleToggleUnreadOnly}
              aria-pressed={unreadOnly}
            >
              {unreadOnly ? 'Showing unread' : 'Unread only'}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleMarkAllRead()}
              disabled={unreadCount === 0 || isMarkingAll}
            >
              <CheckCheck className="w-4 h-4 inline mr-2" aria-hidden="true" />
              {isMarkingAll ? 'Marking...' : 'Mark all read'}
            </button>
          </div>
        </div>

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
                onClick={() => void fetchNotifications({ initial: !hasLoadedOnceRef.current })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6" role="alert">
            {actionError}
          </div>
        )}

        {!loadError && total === 0 && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <Bell className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-2">
                {unreadOnly ? 'No unread notifications' : "You're all caught up"}
              </h2>
              <p className="text-text-muted">
                {unreadOnly
                  ? 'All of your notifications have been read.'
                  : 'New budget, bill, subscription and recurring reminders will appear here.'}
              </p>
            </div>
          </div>
        )}

        {!loadError && total > 0 && (
          <>
            <div className="space-y-3" data-testid="notification-list">
              {notifications.map((notification) => {
                const Icon = TYPE_ICONS[notification.type];
                return (
                  <div
                    key={notification.id}
                    className={`card border-l-2 ${
                      notification.isRead ? 'border-transparent' : 'border-primary'
                    }`}
                  >
                    <div className="card-body flex items-start gap-4 py-4">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          notification.isRead ? 'bg-background' : 'bg-primary-light'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 ${
                            notification.isRead ? 'text-text-muted' : 'text-primary'
                          }`}
                          aria-hidden="true"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p
                            className={`text-sm ${
                              notification.isRead
                                ? 'text-text-muted font-normal'
                                : 'text-text font-semibold'
                            }`}
                          >
                            {notification.title}
                          </p>
                          <span className="text-xs text-text-muted whitespace-nowrap">
                            {createdAtLabel(notification.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-text-muted mt-1">{notification.message}</p>
                      </div>
                      {!notification.isRead && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm shrink-0"
                          onClick={() => void handleMarkRead(notification)}
                          aria-label={`Mark "${notification.title}" as read`}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {total > PAGE_SIZE && (
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1 || isFetching}
                >
                  Previous
                </button>
                <span className="text-sm text-text-muted" data-testid="page-indicator">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={page >= totalPages || isFetching}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
