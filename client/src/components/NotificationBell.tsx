import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { notificationApi } from '../services/notificationApi';

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await notificationApi.generateNotifications();
        if (cancelled) return;
        const result = await notificationApi.getUnreadCount();
        if (!cancelled) {
          setUnreadCount(result.unreadCount);
        }
      } catch {
        // Keep the indicator quiet when generation fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    unreadCount > 0
      ? `Notifications, ${unreadCount} unread`
      : 'Notifications';

  return (
    <Link
      to="/notifications"
      className="btn-ghost p-2 relative"
      aria-label={label}
      data-testid="notification-bell"
    >
      <Bell className="w-5 h-5" aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none"
          data-testid="notification-badge"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
