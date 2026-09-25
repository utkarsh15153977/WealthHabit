import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { notificationApi } from '../services/notificationApi';

vi.mock('../services/notificationApi', () => ({
  notificationApi: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn(),
    generateNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
  },
}));

const mockedApi = vi.mocked(notificationApi);

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<NotificationBell />} />
        <Route path="/notifications" element={<div>notifications-page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mockedApi.generateNotifications.mockResolvedValue({ created: 0 });
    mockedApi.getUnreadCount.mockResolvedValue({ unreadCount: 0 });
  });

  it('shows no badge when the unread count is zero', async () => {
    renderBell();

    await waitFor(() => {
      expect(mockedApi.generateNotifications).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockedApi.getUnreadCount).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('notification-badge')).toBeNull();
    expect(screen.getByTestId('notification-bell')).toHaveAttribute(
      'aria-label',
      'Notifications'
    );
  });

  it('shows the unread count badge when notifications are unread', async () => {
    mockedApi.getUnreadCount.mockResolvedValue({ unreadCount: 3 });

    renderBell();

    const badge = await screen.findByTestId('notification-badge');
    expect(badge).toHaveTextContent('3');
    expect(screen.getByTestId('notification-bell')).toHaveAttribute(
      'aria-label',
      'Notifications, 3 unread'
    );
  });

  it('navigates to the notification center when clicked', async () => {
    renderBell();

    const bell = await screen.findByTestId('notification-bell');
    fireEvent.click(bell);

    expect(await screen.findByText('notifications-page')).toBeDefined();
  });

  it('stays quiet when generation fails', async () => {
    mockedApi.generateNotifications.mockRejectedValue(new Error('offline'));

    renderBell();

    await waitFor(() => {
      expect(mockedApi.generateNotifications).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });
});
