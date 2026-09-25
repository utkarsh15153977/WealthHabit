import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Goals } from './Goals';
import { goalApi } from '../services/goalApi';
import { getMyProfile } from '../services/userApi';
import type { Goal, GoalContribution, GoalListResponse } from '../types/goal';

vi.mock('../services/goalApi', () => ({
  goalApi: {
    getGoals: vi.fn(),
    getGoal: vi.fn(),
    getGoalProgress: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    getGoalContributions: vi.fn(),
    createGoalContribution: vi.fn(),
    updateGoalContribution: vi.fn(),
    deleteGoalContribution: vi.fn(),
  },
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
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

const mockedGoals = vi.mocked(goalApi);
const mockedProfile = vi.mocked(getMyProfile);

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    name: 'Emergency fund',
    description: 'Six months of expenses',
    category: 'emergency',
    priority: 'HIGH',
    status: 'ACTIVE',
    targetAmount: 1000,
    currentAmount: 250,
    remainingAmount: 750,
    progressPercent: 25,
    contributionCount: 2,
    targetDate: '2026-12-31T00:00:00.000Z',
    overdue: false,
    monthlyContribution: 100,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeList(...goals: Goal[]): GoalListResponse {
  return {
    goals,
    page: 1,
    pageSize: 50,
    total: goals.length,
    activeCount: goals.filter((goal) => goal.status === 'ACTIVE').length,
    totalTargetAmount: goals.reduce((sum, goal) => sum + goal.targetAmount, 0),
    totalSavedAmount: goals.reduce((sum, goal) => sum + goal.currentAmount, 0),
    nearestTargetDate:
      goals.find((goal) => goal.status === 'ACTIVE')?.targetDate ?? null,
  };
}

function makeContribution(
  overrides: Partial<GoalContribution> = {}
): GoalContribution {
  return {
    id: 'ct1',
    goalId: 'g1',
    amount: 50,
    contributionDate: '2026-09-20T00:00:00.000Z',
    note: 'Payday',
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

function renderGoals() {
  return render(
    <MemoryRouter>
      <Goals />
    </MemoryRouter>
  );
}

async function openCreateForm() {
  renderGoals();
  fireEvent.click(await screen.findByTestId('create-goal-button'));
  await screen.findByTestId('goal-form');
}

describe('Goals page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProfile.mockResolvedValue({
      profile: { financialProfile: { currency: 'USD' } },
    } as Awaited<ReturnType<typeof getMyProfile>>);
    mockedGoals.getGoals.mockResolvedValue(makeList());
    mockedGoals.getGoalContributions.mockResolvedValue({
      contributions: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
  });

  describe('listing and summary', () => {
    it('loads goals and shows derived progress on cards', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));

      renderGoals();

      expect(mockedGoals.getGoals).toHaveBeenCalledWith({ pageSize: 50 });

      const card = await screen.findByTestId('goal-card-Emergency fund');
      expect(within(card).getByTestId('goal-current-Emergency fund')).toHaveTextContent(
        '$250.00'
      );
      expect(within(card).getByTestId('goal-target-Emergency fund')).toHaveTextContent(
        '$1,000.00'
      );
      expect(within(card).getByTestId('goal-percent-Emergency fund')).toHaveTextContent(
        '25%'
      );
      expect(within(card).getByTestId('goal-remaining-Emergency fund')).toHaveTextContent(
        '$750.00'
      );
      expect(within(card).getByTestId('goal-status-Emergency fund')).toHaveTextContent(
        'Active'
      );
      expect(within(card).getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '25'
      );
      expect(within(card).getByText('2 contributions')).toBeDefined();
    });

    it('shows the summary header counts', async () => {
      mockedGoals.getGoals.mockResolvedValue({
        ...makeList(makeGoal()),
        activeCount: 3,
        totalTargetAmount: 4500,
        totalSavedAmount: 1200,
        nearestTargetDate: '2026-11-01T00:00:00.000Z',
      });

      renderGoals();

      expect(await screen.findByTestId('goals-active-count')).toHaveTextContent(
        '3 active'
      );
      expect(screen.getByTestId('goals-saved-total')).toHaveTextContent(
        '$1,200.00 saved'
      );
      expect(screen.getByTestId('goals-target-total')).toHaveTextContent(
        '$4,500.00 targeted'
      );
      expect(screen.getByTestId('goals-nearest-target')).toHaveTextContent(
        'Nearest target'
      );
    });

    it('shows an overdue badge for overdue goals', async () => {
      mockedGoals.getGoals.mockResolvedValue(
        makeList(makeGoal({ overdue: true }))
      );

      renderGoals();

      expect(
        (await screen.findByTestId('goal-overdue-Emergency fund')).textContent
      ).toBe('Overdue');
    });

    it('groups goals into sections by status', async () => {
      mockedGoals.getGoals.mockResolvedValue(
        makeList(
          makeGoal({ id: 'g1', name: 'Active one' }),
          makeGoal({ id: 'g2', name: 'Done one', status: 'COMPLETED' }),
          makeGoal({ id: 'g3', name: 'Paused one', status: 'PAUSED' }),
          makeGoal({ id: 'g4', name: 'Cancelled one', status: 'CANCELLED' })
        )
      );

      renderGoals();

      await screen.findByTestId('goal-card-Active one');
      expect(screen.getByTestId('goal-card-Done one')).toBeDefined();
      expect(screen.getByTestId('goal-card-Paused one')).toBeDefined();
      expect(screen.getByTestId('goal-card-Cancelled one')).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Active goals' })).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Completed goals' })).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Paused goals' })).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Cancelled goals' })).toBeDefined();
      expect(screen.getByTestId('goal-status-Done one')).toHaveTextContent(
        'Completed'
      );
    });

    it('shows the empty state with a create button', async () => {
      renderGoals();

      expect(await screen.findByText('No savings goals yet')).toBeDefined();
      expect(screen.getByTestId('goals-empty-create')).toBeDefined();
      expect(screen.queryByTestId('goal-form')).toBeNull();
    });

    it('shows a load error with retry that refetches', async () => {
      mockedGoals.getGoals.mockRejectedValueOnce(new Error('Server down'));

      renderGoals();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Server down');

      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      fireEvent.click(screen.getByText('Retry'));

      await screen.findByTestId('goal-card-Emergency fund');
      expect(mockedGoals.getGoals).toHaveBeenCalledTimes(2);
    });
  });

  describe('create goal', () => {
    it('validates required fields before calling the API', async () => {
      await openCreateForm();

      fireEvent.click(screen.getByTestId('goal-submit'));

      expect(await screen.findByText('Goal name is required')).toBeDefined();
      expect(screen.getByText('Target amount is required')).toBeDefined();
      expect(mockedGoals.createGoal).not.toHaveBeenCalled();
    });

    it('rejects an invalid target amount', async () => {
      await openCreateForm();

      fireEvent.change(screen.getByTestId('goal-name-input'), {
        target: { value: 'Trip' },
      });
      fireEvent.change(screen.getByTestId('goal-target-amount-input'), {
        target: { value: '0' },
      });
      fireEvent.click(screen.getByTestId('goal-submit'));

      expect(
        await screen.findByText('Target amount must be greater than zero')
      ).toBeDefined();
      expect(mockedGoals.createGoal).not.toHaveBeenCalled();
    });

    it('creates a goal and shows a success message', async () => {
      mockedGoals.createGoal.mockResolvedValue(makeGoal({ name: 'Trip' }));
      await openCreateForm();

      fireEvent.change(screen.getByTestId('goal-name-input'), {
        target: { value: 'Trip' },
      });
      fireEvent.change(screen.getByTestId('goal-target-amount-input'), {
        target: { value: '1500' },
      });
      fireEvent.change(screen.getByTestId('goal-target-date-input'), {
        target: { value: '2027-06-30' },
      });
      fireEvent.click(screen.getByTestId('goal-submit'));

      await waitFor(() => expect(mockedGoals.createGoal).toHaveBeenCalled());
      expect(mockedGoals.createGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Trip',
          targetAmount: '1500',
          targetDate: '2027-06-30',
          priority: 'MEDIUM',
          monthlyContribution: null,
        })
      );
      expect(await screen.findByTestId('goals-success')).toHaveTextContent(
        'Goal "Trip" created'
      );
      await waitFor(() => expect(screen.queryByTestId('goal-form')).toBeNull());
      expect(mockedGoals.getGoals).toHaveBeenCalledTimes(2);
    });

    it('shows an API error without closing the form', async () => {
      mockedGoals.createGoal.mockRejectedValue(new Error('Name is taken'));
      await openCreateForm();

      fireEvent.change(screen.getByTestId('goal-name-input'), {
        target: { value: 'Trip' },
      });
      fireEvent.change(screen.getByTestId('goal-target-amount-input'), {
        target: { value: '100' },
      });
      fireEvent.click(screen.getByTestId('goal-submit'));

      expect(await screen.findByTestId('goal-form-error')).toHaveTextContent(
        'Name is taken'
      );
      expect(screen.getByTestId('goal-form')).toBeDefined();
    });
  });

  describe('edit goal', () => {
    it('opens prefilled and updates the goal', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.updateGoal.mockResolvedValue(makeGoal({ name: 'Renamed' }));
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-edit-Emergency fund'));
      await screen.findByTestId('goal-form');

      const nameInput = screen.getByTestId('goal-name-input') as HTMLInputElement;
      expect(nameInput.value).toBe('Emergency fund');
      expect(
        (screen.getByTestId('goal-target-amount-input') as HTMLInputElement).value
      ).toBe('1000');
      expect(screen.getByTestId('goal-status-select')).toBeDefined();

      fireEvent.change(nameInput, { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByTestId('goal-submit'));

      await waitFor(() => expect(mockedGoals.updateGoal).toHaveBeenCalled());
      expect(mockedGoals.updateGoal).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ name: 'Renamed', status: 'ACTIVE' })
      );
      expect(await screen.findByTestId('goals-success')).toHaveTextContent(
        'Goal "Renamed" updated'
      );
    });

    it('allows switching a goal to paused', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.updateGoal.mockResolvedValue(makeGoal({ status: 'PAUSED' }));
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-edit-Emergency fund'));
      await screen.findByTestId('goal-form');

      fireEvent.change(screen.getByTestId('goal-status-select'), {
        target: { value: 'PAUSED' },
      });
      fireEvent.click(screen.getByTestId('goal-submit'));

      await waitFor(() => expect(mockedGoals.updateGoal).toHaveBeenCalled());
      expect(mockedGoals.updateGoal).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ status: 'PAUSED' })
      );
    });
  });

  describe('delete goal', () => {
    it('confirms before deleting and refreshes the list', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.deleteGoal.mockResolvedValue({ message: 'Goal deleted' });
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-delete-Emergency fund'));
      const modal = await screen.findByTestId('delete-goal-modal');
      expect(within(modal).getByText('Emergency fund')).toBeDefined();

      fireEvent.click(screen.getByTestId('delete-goal-confirm'));

      await waitFor(() => expect(mockedGoals.deleteGoal).toHaveBeenCalledWith('g1'));
      expect(await screen.findByTestId('goals-success')).toHaveTextContent(
        'Goal "Emergency fund" deleted'
      );
    });

    it('cancels without deleting', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-delete-Emergency fund'));
      const modal = await screen.findByTestId('delete-goal-modal');
      fireEvent.click(within(modal).getByText('Cancel'));

      await waitFor(() =>
        expect(screen.queryByTestId('delete-goal-modal')).toBeNull()
      );
      expect(mockedGoals.deleteGoal).not.toHaveBeenCalled();
    });
  });

  describe('contributions', () => {
    it('opens the modal and lists contribution history', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.getGoalContributions.mockResolvedValue({
        contributions: [
          makeContribution(),
          makeContribution({ id: 'ct2', amount: 200, note: null }),
        ],
        page: 1,
        pageSize: 50,
        total: 2,
      });
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));

      const modal = await screen.findByTestId('contributions-modal');
      expect(mockedGoals.getGoalContributions).toHaveBeenCalledWith('g1', {
        pageSize: 50,
      });
      expect(within(modal).getByText('$50.00')).toBeDefined();
      expect(within(modal).getByText('Payday')).toBeDefined();
      expect(within(modal).getByText('$200.00')).toBeDefined();
    });

    it('shows an empty history message', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));

      expect(await screen.findByTestId('contributions-empty')).toHaveTextContent(
        'No contributions yet'
      );
    });

    it('adds a contribution and refreshes goals', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.createGoalContribution.mockResolvedValue(
        makeContribution({ amount: 75 })
      );
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));
      await screen.findByTestId('contributions-modal');

      fireEvent.change(screen.getByTestId('contribution-amount-input'), {
        target: { value: '75' },
      });
      fireEvent.click(screen.getByTestId('contribution-submit'));

      await waitFor(() =>
        expect(mockedGoals.createGoalContribution).toHaveBeenCalledWith('g1', {
          amount: '75',
          contributionDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          note: undefined,
        })
      );
      expect(await screen.findByTestId('goals-success')).toHaveTextContent(
        'Contribution added'
      );
      await waitFor(() =>
        expect(mockedGoals.getGoalContributions).toHaveBeenCalledTimes(2)
      );
      expect(mockedGoals.getGoals).toHaveBeenCalledTimes(2);
    });

    it('validates the contribution amount client-side', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));
      await screen.findByTestId('contributions-modal');

      fireEvent.click(screen.getByTestId('contribution-submit'));

      expect(await screen.findByText('Amount is required')).toBeDefined();
      expect(mockedGoals.createGoalContribution).not.toHaveBeenCalled();
    });

    it('edits an existing contribution', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.getGoalContributions.mockResolvedValue({
        contributions: [makeContribution()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedGoals.updateGoalContribution.mockResolvedValue(
        makeContribution({ amount: 90 })
      );
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));
      await screen.findByTestId('contributions-modal');

      fireEvent.click(screen.getByTestId('contribution-edit-ct1'));

      await waitFor(() => {
        expect(
          (screen.getByTestId('contribution-amount-input') as HTMLInputElement).value
        ).toBe('50');
      });

      fireEvent.change(screen.getByTestId('contribution-amount-input'), {
        target: { value: '90' },
      });
      fireEvent.click(screen.getByTestId('contribution-submit'));

      await waitFor(() =>
        expect(mockedGoals.updateGoalContribution).toHaveBeenCalledWith(
          'g1',
          'ct1',
          expect.objectContaining({ amount: '90' })
        )
      );
      expect(await screen.findByTestId('goals-success')).toHaveTextContent(
        'Contribution updated'
      );
    });

    it('deletes a contribution', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.getGoalContributions.mockResolvedValue({
        contributions: [makeContribution()],
        page: 1,
        pageSize: 50,
        total: 1,
      });
      mockedGoals.deleteGoalContribution.mockResolvedValue({
        message: 'Contribution deleted',
      });
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));
      await screen.findByTestId('contributions-modal');

      fireEvent.click(screen.getByTestId('contribution-delete-ct1'));

      await waitFor(() =>
        expect(mockedGoals.deleteGoalContribution).toHaveBeenCalledWith('g1', 'ct1')
      );
      expect(await screen.findByTestId('goals-success')).toHaveTextContent(
        'Contribution deleted'
      );
    });

    it('shows API errors inside the modal', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      mockedGoals.createGoalContribution.mockRejectedValue(
        new Error('Contribution rejected')
      );
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));
      await screen.findByTestId('contributions-modal');

      fireEvent.change(screen.getByTestId('contribution-amount-input'), {
        target: { value: '25' },
      });
      fireEvent.click(screen.getByTestId('contribution-submit'));

      const modal = await screen.findByTestId('contributions-modal');
      await waitFor(() => {
        expect(
          within(modal).getByTestId('contribution-form-error')
        ).toHaveTextContent('Contribution rejected');
      });
    });

    it('closes the contributions modal', async () => {
      mockedGoals.getGoals.mockResolvedValue(makeList(makeGoal()));
      renderGoals();

      fireEvent.click(await screen.findByTestId('goal-add-money-Emergency fund'));
      await screen.findByTestId('contributions-modal');

      fireEvent.click(screen.getByLabelText('Close contributions'));

      await waitFor(() =>
        expect(screen.queryByTestId('contributions-modal')).toBeNull()
      );
    });
  });
});
