import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Habits } from './Habits';
import { habitApi } from '../services/habitApi';
import type { HabitListResponse, HabitWithProgress } from '../types/habit';

vi.mock('../services/habitApi', () => ({
  habitApi: {
    getHabits: vi.fn(),
    createHabit: vi.fn(),
    updateHabit: vi.fn(),
    deleteHabit: vi.fn(),
    completeHabit: vi.fn(),
    uncompleteHabit: vi.fn(),
    getHabitCompletions: vi.fn(),
    getHabitProgress: vi.fn(),
  },
}));

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

vi.mock('../services/notificationApi', () => ({
  notificationApi: {
    getNotifications: vi.fn(),
    getUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 0 }),
    generateNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    deleteNotification: vi.fn(),
  },
}));

const mockedApi = vi.mocked(habitApi);

function makeHabit(overrides: Partial<HabitWithProgress> = {}): HabitWithProgress {
  return {
    id: 'h1',
    name: 'Track daily expenses',
    description: null,
    frequency: 'DAILY',
    target: null,
    unit: null,
    startDate: new Date().toISOString(),
    endDate: null,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: {
      habitId: 'h1',
      currentPeriod: { completed: false, period: '2026-09-25' },
      totalCompletions: 0,
      completionRate: 0,
      active: true,
    },
    ...overrides,
  };
}

function listResponse(
  habits: HabitWithProgress[],
  total: number,
  page = 1
): HabitListResponse {
  return { habits, page, pageSize: 10, total };
}

const emptyPaused: HabitListResponse = {
  habits: [],
  page: 1,
  pageSize: 50,
  total: 0,
};

function mockLists(active: HabitWithProgress[], total = active.length) {
  mockedApi.getHabits.mockImplementation(async (params) => {
    if (params?.active === false) return emptyPaused;
    return listResponse(active, total, params?.page ?? 1);
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Habits />
    </MemoryRouter>
  );
}

describe('Habits page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLists([]);
    mockedApi.completeHabit.mockResolvedValue({
      completion: {
        habitId: 'h1',
        completionDate: new Date().toISOString(),
        period: '2026-09-25',
        completedAt: new Date().toISOString(),
      },
      alreadyCompleted: false,
    });
    mockedApi.updateHabit.mockImplementation(async (id) => ({
      habit: makeHabit({ id }),
    }));
    mockedApi.createHabit.mockResolvedValue({ habit: makeHabit() });
    mockedApi.deleteHabit.mockResolvedValue({ message: 'Habit deleted' });
  });

  it('shows the empty state when there are no habits', async () => {
    renderPage();

    expect(await screen.findByText('No habits yet')).toBeDefined();
    expect(
      screen.getByRole('button', { name: /create habit/i })
    ).toBeDefined();
  });

  it('lists active habits with progress details', async () => {
    mockLists([
      makeHabit({
        target: 500,
        unit: 'INR',
        description: 'Log every rupee',
        progress: {
          habitId: 'h1',
          currentPeriod: { completed: false, period: '2026-09-25' },
          totalCompletions: 4,
          completionRate: 80,
          active: true,
        },
      }),
    ]);

    renderPage();

    expect(await screen.findByText('Track daily expenses')).toBeDefined();
    expect(screen.getByText('Daily · target 500 INR')).toBeDefined();
    expect(screen.getByText('Log every rupee')).toBeDefined();
    expect(screen.getByText('Due today')).toBeDefined();
    expect(screen.getByText('4 · 80%')).toBeDefined();
    expect(mockedApi.getHabits).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, includeProgress: true })
    );
  });

  it('shows completed habits as completed and disabled', async () => {
    mockLists([
      makeHabit({
        progress: {
          habitId: 'h1',
          currentPeriod: { completed: true, period: '2026-09-25' },
          totalCompletions: 1,
          completionRate: 100,
          active: true,
        },
      }),
    ]);

    renderPage();

    expect(await screen.findByText('Completed today')).toBeDefined();
    const button = screen.getByRole('button', { name: 'Complete Track daily expenses' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Completed');
  });

  it('completes a habit and refreshes the list', async () => {
    const habit = makeHabit();
    mockLists([habit]);
    mockedApi.completeHabit.mockResolvedValue({
      completion: {
        habitId: 'h1',
        completionDate: new Date().toISOString(),
        period: '2026-09-25',
        completedAt: new Date().toISOString(),
      },
      alreadyCompleted: false,
    });

    renderPage();

    const button = await screen.findByRole('button', {
      name: 'Complete Track daily expenses',
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedApi.completeHabit).toHaveBeenCalledWith('h1');
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      '"Track daily expenses" completed'
    );
  });

  it('surfaces completion failures as an alert', async () => {
    mockLists([makeHabit()]);
    mockedApi.completeHabit.mockRejectedValue(new Error('Habit is no longer active'));

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Complete Track daily expenses' })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Habit is no longer active');
    expect(mockedApi.completeHabit).toHaveBeenCalledWith('h1');
  });

  it('shows paused habits in a separate section with a resume action', async () => {
    const paused = makeHabit({
      id: 'h2',
      name: 'Weekly review',
      isActive: false,
      progress: undefined,
    });
    mockedApi.getHabits.mockImplementation(async (params) => {
      if (params?.active === false) {
        return { ...emptyPaused, habits: [paused], total: 1 };
      }
      return listResponse([], 0);
    });

    renderPage();

    expect(await screen.findByText('Paused habits')).toBeDefined();
    expect(screen.getByText('Weekly review')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Resume Weekly review' }));

    await waitFor(() => {
      expect(mockedApi.updateHabit).toHaveBeenCalledWith('h2', { isActive: true });
    });
  });

  it('pauses an active habit', async () => {
    mockLists([makeHabit()]);

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Pause Track daily expenses' })
    );

    await waitFor(() => {
      expect(mockedApi.updateHabit).toHaveBeenCalledWith('h1', { isActive: false });
    });
  });

  it('validates the create form before submitting', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /new habit/i }));

    const dialog = await screen.findByRole('dialog');
    const form = dialog.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    expect(await screen.findByText('Name is required')).toBeDefined();
    expect(mockedApi.createHabit).not.toHaveBeenCalled();
  });

  it('creates a habit with normalized payload', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /new habit/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'Review subscriptions' },
    });
    fireEvent.change(screen.getByLabelText(/^frequency/i), {
      target: { value: 'WEEKLY' },
    });
    fireEvent.change(screen.getByLabelText(/target/i), {
      target: { value: '120.50' },
    });
    fireEvent.change(screen.getByLabelText(/unit/i), {
      target: { value: 'INR' },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: '' },
    });

    const submit = within(dialog).getByRole('button', { name: 'Create habit' });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockedApi.createHabit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Review subscriptions',
          frequency: 'WEEKLY',
          target: '120.50',
          unit: 'INR',
          endDate: null,
        })
      );
    });
    expect(dialog).not.toBeInTheDocument();
  });

  it('rejects an endDate before the startDate in the form', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /new habit/i }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'Bounded habit' },
    });
    const start = screen.getByLabelText(/start date/i) as HTMLInputElement;
    const end = screen.getByLabelText(/end date/i) as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-10-10' } });
    fireEvent.change(end, { target: { value: '2026-10-01' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }));

    expect(
      await screen.findByText('End date must be on or after start date')
    ).toBeDefined();
    expect(mockedApi.createHabit).not.toHaveBeenCalled();
  });

  it('edits an existing habit via the modal', async () => {
    mockLists([makeHabit()]);

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit Track daily expenses' })
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Edit Habit');

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'Track daily expenses v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockedApi.updateHabit).toHaveBeenCalledWith(
        'h1',
        expect.objectContaining({ name: 'Track daily expenses v2' })
      );
    });
    expect(mockedApi.updateHabit.mock.calls[0][1]).not.toHaveProperty('isActive');
  });

  it('deletes a habit after confirmation', async () => {
    mockLists([makeHabit()]);

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Track daily expenses' })
    );

    const alertdialog = await screen.findByRole('alertdialog');
    expect(alertdialog).toHaveTextContent('Track daily expenses');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockedApi.deleteHabit).toHaveBeenCalledWith('h1');
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Habit deleted successfully'
    );
  });

  it('shows a recoverable error when loading fails', async () => {
    mockedApi.getHabits.mockRejectedValue(new Error('Network down'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network down');

    mockLists([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('No habits yet')).toBeDefined();
    });
  });

  it('paginates active habits when there are more than 10', async () => {
    mockLists([makeHabit()], 25);

    renderPage();

    expect(await screen.findByTestId('page-indicator')).toHaveTextContent(
      'Page 1 of 3'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedApi.getHabits).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      );
    });
  });
});
