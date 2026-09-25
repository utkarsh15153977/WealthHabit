import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';
import { getDashboardSummary } from '../services/dashboardApi';
import { budgetApi } from '../services/budgetApi';
import { recurringTransactionApi } from '../services/recurringTransactionApi';
import { billApi } from '../services/billApi';
import { subscriptionApi } from '../services/subscriptionApi';
import { notificationApi } from '../services/notificationApi';
import { habitApi } from '../services/habitApi';
import { challengeApi } from '../services/challengeApi';
import type { DashboardSummaryData } from '../types/dashboard';
import type { HabitWithProgress } from '../types/habit';
import type { Challenge, ChallengeListResponse } from '../types/challenge';

vi.mock('../services/dashboardApi', () => ({
  getDashboardSummary: vi.fn(),
}));

vi.mock('../services/budgetApi', () => ({
  budgetApi: { getBudgets: vi.fn() },
}));

vi.mock('../services/recurringTransactionApi', () => ({
  recurringTransactionApi: { getRecurringTransactions: vi.fn() },
}));

vi.mock('../services/billApi', () => ({
  billApi: { getBills: vi.fn() },
}));

vi.mock('../services/subscriptionApi', () => ({
  subscriptionApi: { getSubscriptions: vi.fn() },
}));

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

vi.mock('../services/habitApi', () => ({
  habitApi: { getHabits: vi.fn() },
}));

vi.mock('../services/challengeApi', () => ({
  challengeApi: { getChallenges: vi.fn() },
}));

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    logout: vi.fn(),
    updateUser: vi.fn(),
  }),
}));

const mockedSummary = vi.mocked(getDashboardSummary);
const mockedHabits = vi.mocked(habitApi.getHabits);
const mockedChallenges = vi.mocked(challengeApi.getChallenges);

const emptyChallengeList: ChallengeListResponse = {
  challenges: [],
  page: 1,
  pageSize: 3,
  total: 0,
  activeCount: 0,
  joinedCount: 0,
};

function makeChallenge(
  id: string,
  name: string,
  completionRate: number,
  completed: boolean
): Challenge {
  return {
    id,
    name,
    description: 'Track expenses for 7 days',
    type: 'HABIT_COMPLETION',
    category: 'general',
    difficulty: 'MEDIUM',
    points: 50,
    startDate: '2026-09-20',
    endDate: '2026-09-30',
    isActive: true,
    status: 'ACTIVE',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    requirements: [],
    participation: {
      joined: true,
      joinedAt: '2026-09-20T00:00:00.000Z',
      status: completed ? 'COMPLETED' : 'JOINED',
      progress: {
        challengeId: id,
        joined: true,
        status: completed ? 'COMPLETED' : 'JOINED',
        startDate: '2026-09-20',
        endDate: '2026-09-30',
        completedPeriods: completed ? 7 : 5,
        eligiblePeriods: 7,
        completionRate,
        completed,
        requirements: [],
      },
    },
  };
}

const emptySummary: DashboardSummaryData = {
  period: {
    month: '2026-09',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-10-01T00:00:00.000Z',
    timezone: 'UTC',
  },
  currency: 'USD',
  summary: { income: 0, expenses: 0, savings: 0, savingsRate: 0 },
  monthlySummary: {
    month: '2026-09',
    income: 0,
    expenses: 0,
    savings: 0,
    transactionCount: 0,
    incomeTarget: null,
    savingsTarget: null,
  },
  targets: { monthlyIncomeTarget: null, monthlySavingsTarget: null },
  recentTransactions: [],
  incomeExpenseTrend: [],
  spendingByCategory: [],
};

function makeHabit(
  id: string,
  name: string,
  completed: boolean
): HabitWithProgress {
  return {
    id,
    name,
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
      habitId: id,
      frequency: 'DAILY',
      currentPeriod: { completed, period: '2026-09-25' },
      streak: { current: completed ? 5 : 0, longest: completed ? 8 : 0 },
      totalCompletions: completed ? 1 : 0,
      eligiblePeriods: 1,
      completionRate: completed ? 100 : 0,
      active: true,
    },
  };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

describe('Dashboard habit summary card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSummary.mockResolvedValue(emptySummary);
    vi.mocked(budgetApi.getBudgets).mockResolvedValue({
      budgets: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof budgetApi.getBudgets>>);
    vi.mocked(
      recurringTransactionApi.getRecurringTransactions
    ).mockResolvedValue({
      recurringTransactions: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof recurringTransactionApi.getRecurringTransactions>>);
    vi.mocked(billApi.getBills).mockResolvedValue({
      bills: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof billApi.getBills>>);
    vi.mocked(subscriptionApi.getSubscriptions).mockResolvedValue({
      subscriptions: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof subscriptionApi.getSubscriptions>>);
    vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
      unreadCount: 0,
    });
    vi.mocked(notificationApi.generateNotifications).mockResolvedValue({
      created: 0,
    });
    mockedHabits.mockResolvedValue({
      habits: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    mockedChallenges.mockResolvedValue(emptyChallengeList);
  });

  it('shows completed vs total active habits with per-habit state', async () => {
    mockedHabits.mockResolvedValue({
      habits: [
        makeHabit('h1', 'Track daily expenses', true),
        makeHabit('h2', 'Review subscriptions', false),
      ],
      page: 1,
      pageSize: 50,
      total: 2,
    });

    renderDashboard();

    const summary = await screen.findByTestId('dashboard-habit-summary');
    expect(screen.getByTestId('dashboard-habits-completed')).toHaveTextContent(
      '1 of 2'
    );
    expect(summary).toHaveTextContent(
      'active habits completed for the current period'
    );
    expect(screen.getByText('Track daily expenses')).toBeDefined();
    expect(screen.getByText('Completed')).toBeDefined();
    expect(screen.getByText('Review subscriptions')).toBeDefined();
    expect(screen.getByText('Pending')).toBeDefined();
    expect(
      screen.getByTestId('dashboard-habit-streak-Track daily expenses')
    ).toHaveTextContent('5 streak');
    expect(
      screen.getByTestId('dashboard-habit-streak-Review subscriptions')
    ).toHaveTextContent('0 streak');
    expect(mockedHabits).toHaveBeenCalledWith({
      active: true,
      includeProgress: true,
      pageSize: 50,
    });
  });

  it('shows the empty state when there are no active habits', async () => {
    renderDashboard();

    expect(
      await screen.findByText(/No active habits\./)
    ).toBeDefined();
    expect(screen.queryByTestId('dashboard-habit-summary')).toBeNull();
  });

  it('shows an inline error when habits fail to load', async () => {
    mockedHabits.mockRejectedValue(new Error('Habits unavailable'));

    renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Habits unavailable');
    expect(screen.queryByTestId('dashboard-habit-summary')).toBeNull();
  });
});

describe('Dashboard challenges card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSummary.mockResolvedValue(emptySummary);
    vi.mocked(budgetApi.getBudgets).mockResolvedValue({
      budgets: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof budgetApi.getBudgets>>);
    vi.mocked(
      recurringTransactionApi.getRecurringTransactions
    ).mockResolvedValue({
      recurringTransactions: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<
      ReturnType<typeof recurringTransactionApi.getRecurringTransactions>
    >);
    vi.mocked(billApi.getBills).mockResolvedValue({
      bills: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof billApi.getBills>>);
    vi.mocked(subscriptionApi.getSubscriptions).mockResolvedValue({
      subscriptions: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as Awaited<ReturnType<typeof subscriptionApi.getSubscriptions>>);
    vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
      unreadCount: 0,
    });
    vi.mocked(notificationApi.generateNotifications).mockResolvedValue({
      created: 0,
    });
    mockedHabits.mockResolvedValue({
      habits: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    mockedChallenges.mockResolvedValue(emptyChallengeList);
  });

  it('shows active and joined counts with progress for joined challenges', async () => {
    mockedChallenges.mockResolvedValue({
      challenges: [
        makeChallenge('c1', 'Expense Tracking Week', 71, false),
        makeChallenge('c2', 'Subscription Audit', 100, true),
      ],
      page: 1,
      pageSize: 3,
      total: 2,
      activeCount: 3,
      joinedCount: 2,
    });

    renderDashboard();

    const summary = await screen.findByTestId('dashboard-challenge-summary');
    expect(screen.getByTestId('dashboard-challenges-active')).toHaveTextContent(
      '3 active'
    );
    expect(screen.getByTestId('dashboard-challenges-joined')).toHaveTextContent(
      '2 joined'
    );
    expect(
      screen.getByTestId('dashboard-challenge-Expense Tracking Week')
    ).toHaveTextContent('71%');
    expect(
      screen.getByTestId('dashboard-challenge-Subscription Audit')
    ).toHaveTextContent('Completed');
    expect(summary).toBeDefined();
    expect(mockedChallenges).toHaveBeenCalledWith({
      joined: true,
      includeProgress: true,
      pageSize: 3,
    });
  });

  it('shows the empty state when the user has not joined any challenges', async () => {
    renderDashboard();

    expect(
      await screen.findByText(
        'You are not participating in any challenges.'
      )
    ).toBeDefined();
    expect(screen.queryByTestId('dashboard-challenge-summary')).toBeNull();
  });

  it('shows an inline error when challenges fail to load', async () => {
    mockedChallenges.mockRejectedValue(new Error('Challenges unavailable'));

    renderDashboard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Challenges unavailable');
    expect(screen.queryByTestId('dashboard-challenge-summary')).toBeNull();
  });
});
