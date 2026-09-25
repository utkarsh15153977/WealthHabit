import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Notifications } from './Notifications';
import { notificationApi } from '../services/notificationApi';
import type { Notification, NotificationListResponse } from '../types/notification';

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

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

const mockedApi = vi.mocked(notificationApi);

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'BUDGET_THRESHOLD',
    title: 'Food budget reached 80%',
    message: 'Your Food budget has reached 80% of its monthly limit.',
    isRead: false,
    createdAt: new Date().toISOString(),
    readAt: null,
    metadata: null,
    ...overrides,
  };
}

function listResponse(
  overrides: Partial<NotificationListResponse> = {}
): NotificationListResponse {
  return {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    unreadCount: 0,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  );
}

describe('Notifications page', () => {
  beforeEach(() => {
    mockedApi.generateNotifications.mockResolvedValue({ created: 1 });
    mockedApi.getNotifications.mockResolvedValue(listResponse());
    mockedApi.getUnreadCount.mockResolvedValue({ unreadCount: 0 });
    mockedApi.markNotificationRead.mockResolvedValue({
      notification: makeNotification({ isRead: true }),
    });
    mockedApi.markAllNotificationsRead.mockResolvedValue({ updated: 1 });
  });

  it('loads and lists notifications with the unread count', async () => {
    mockedApi.getNotifications.mockResolvedValue(
      listResponse({
        items: [makeNotification()],
        total: 1,
        unreadCount: 1,
      })
    );

    renderPage();

    expect(
      await screen.findByText('Food budget reached 80%')
    ).toBeDefined();
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1 unread');
    expect(mockedApi.generateNotifications).toHaveBeenCalled();
  });

  it('shows the empty state when there are no notifications', async () => {
    renderPage();

    expect(await screen.findByText("You're all caught up")).toBeDefined();
    expect(screen.getByTestId('unread-count')).toHaveTextContent(
      'No unread notifications'
    );
  });

  it('visually distinguishes unread and read notifications', async () => {
    mockedApi.getNotifications.mockResolvedValue(
      listResponse({
        items: [
          makeNotification({ id: 'n1', title: 'Unread item' }),
          makeNotification({
            id: 'n2',
            title: 'Read item',
            isRead: true,
            readAt: new Date().toISOString(),
          }),
        ],
        total: 2,
        unreadCount: 1,
      })
    );

    renderPage();

    const unreadCard = (await screen.findByText('Unread item')).closest(
      '.card'
    ) as HTMLElement;
    const readCard = screen.getByText('Read item').closest('.card') as HTMLElement;

    expect(unreadCard.className).toContain('border-primary');
    expect(readCard.className).toContain('border-transparent');
    expect(screen.getByText('1 unread')).toBeDefined();
  });

  it('marks a single notification as read and refreshes the list', async () => {
    mockedApi.getNotifications
      .mockResolvedValueOnce(
        listResponse({ items: [makeNotification()], total: 1, unreadCount: 1 })
      )
      .mockResolvedValueOnce(
        listResponse({
          items: [makeNotification({ isRead: true, readAt: new Date().toISOString() })],
          total: 1,
          unreadCount: 0,
        })
      );

    renderPage();

    const button = await screen.findByRole('button', {
      name: 'Mark "Food budget reached 80%" as read',
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedApi.markNotificationRead).toHaveBeenCalledWith('n1');
    });
    expect(
      await screen.findByText('No unread notifications')
    ).toBeDefined();
  });

  it('marks all notifications as read', async () => {
    mockedApi.getNotifications
      .mockResolvedValueOnce(
        listResponse({ items: [makeNotification()], total: 1, unreadCount: 1 })
      )
      .mockResolvedValueOnce(listResponse());

    renderPage();

    expect(await screen.findByText('1 unread')).toBeDefined();
    const button = screen.getByRole('button', { name: /mark all read/i });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedApi.markAllNotificationsRead).toHaveBeenCalled();
    });
    expect(await screen.findByText("You're all caught up")).toBeDefined();
  });

  it('disables the mark all button when there is nothing unread', async () => {
    renderPage();

    const button = await screen.findByRole('button', { name: /mark all read/i });
    expect(button).toBeDisabled();
  });

  it('shows a recoverable error when loading fails', async () => {
    mockedApi.getNotifications.mockRejectedValue(new Error('Network down'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled();
    expect(
      screen.queryByTestId('notification-list')
    ).toBeNull();
  });

  it('paginates the list when there are more than 20 notifications', async () => {
    mockedApi.getNotifications.mockResolvedValue(
      listResponse({
        items: [makeNotification()],
        total: 45,
        unreadCount: 45,
      })
    );

    renderPage();

    expect(await screen.findByTestId('page-indicator')).toHaveTextContent(
      'Page 1 of 3'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedApi.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      );
    });
  });

  it('requests only unread notifications when the filter is active', async () => {
    renderPage();

    const toggle = await screen.findByRole('button', { name: 'Unread only' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockedApi.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ unreadOnly: true })
      );
    });
  });
});
