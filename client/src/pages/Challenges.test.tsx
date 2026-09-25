import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Challenges } from './Challenges';
import { challengeApi } from '../services/challengeApi';
import { habitApi } from '../services/habitApi';
import type {
  Challenge,
  ChallengeListResponse,
  ChallengeProgress,
} from '../types/challenge';
import type { HabitWithProgress } from '../types/habit';

vi.mock('../services/challengeApi', () => ({
  challengeApi: {
    getChallenges: vi.fn(),
    getChallenge: vi.fn(),
    createChallenge: vi.fn(),
    updateChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
    joinChallenge: vi.fn(),
    leaveChallenge: vi.fn(),
    getChallengeProgress: vi.fn(),
    mapChallengeHabit: vi.fn(),
  },
}));

vi.mock('../services/habitApi', () => ({
  habitApi: { getHabits: vi.fn() },
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

const mockedChallenges = vi.mocked(challengeApi);
const mockedHabits = vi.mocked(habitApi);

function makeProgress(overrides: Partial<ChallengeProgress> = {}): ChallengeProgress {
  return {
    challengeId: 'c1',
    joined: true,
    status: 'JOINED',
    startDate: '2026-09-20',
    endDate: '2026-09-30',
    completedPeriods: 5,
    eligiblePeriods: 7,
    completionRate: 71.43,
    completed: false,
    requirements: [],
    ...overrides,
  };
}

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  const joined = overrides.participation?.joined ?? false;
  return {
    id: 'c1',
    name: 'Expense Tracking Week',
    description: 'Track your expenses every day for a week',
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
    requirements: [
      {
        id: 'r1',
        challengeId: 'c1',
        name: 'Track expenses',
        description: null,
        frequency: 'DAILY',
        target: 1,
        unit: null,
        createdAt: '2026-09-19T00:00:00.000Z',
      },
    ],
    participation: {
      joined,
      joinedAt: joined ? '2026-09-20T00:00:00.000Z' : null,
      status: joined ? 'JOINED' : 'NOT_JOINED',
      progress: joined ? makeProgress() : null,
    },
    ...overrides,
  };
}

function makeList(...challenges: Challenge[]): ChallengeListResponse {
  const joinedCount = challenges.filter((c) => c.participation.joined).length;
  return {
    challenges,
    page: 1,
    pageSize: 50,
    total: challenges.length,
    activeCount: challenges.filter((c) => c.status === 'ACTIVE').length,
    joinedCount,
  };
}

function makeHabit(overrides: Partial<HabitWithProgress> = {}): HabitWithProgress {
  return {
    id: 'h1',
    name: 'Daily ledger',
    description: null,
    frequency: 'DAILY',
    target: null,
    unit: null,
    startDate: '2026-09-01',
    endDate: null,
    isActive: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    progress: undefined,
    ...overrides,
  };
}

function renderChallenges() {
  return render(
    <MemoryRouter>
      <Challenges />
    </MemoryRouter>
  );
}

describe('Challenges page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedHabits.getHabits.mockResolvedValue({
      habits: [makeHabit()],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockedChallenges.getChallenges.mockResolvedValue(makeList());
  });

  it('renders an active challenge card with progress when joined', async () => {
    mockedChallenges.getChallenges.mockResolvedValue(
      makeList(
        makeChallenge({
          participation: {
            joined: true,
            joinedAt: '2026-09-20T00:00:00.000Z',
            status: 'JOINED',
            progress: makeProgress(),
          },
        })
      )
    );

    renderChallenges();

    const card = await screen.findByTestId(
      'challenge-card-Expense Tracking Week'
    );
    expect(
      screen.getByTestId('challenge-status-Expense Tracking Week')
    ).toHaveTextContent('Active');
    const progress = screen.getByTestId('challenge-progress-Expense Tracking Week');
    expect(progress).toHaveTextContent('71.43%');
    expect(progress).toHaveTextContent('5 / 7 periods');
    expect(within(card).getByText('Track expenses')).toBeDefined();
    expect(mockedChallenges.getChallenges).toHaveBeenCalledWith({
      pageSize: 50,
      includeProgress: true,
    });
  });

  it('shows the empty state when there are no challenges', async () => {
    renderChallenges();

    expect(await screen.findByText('No challenges yet')).toBeDefined();
    expect(screen.getByText(/Challenges are created by the WealthHabit team/)).toBeDefined();
  });

  it('joins an active challenge and refreshes with progress', async () => {
    const notJoined = makeChallenge();
    const joined = makeChallenge({
      participation: {
        joined: true,
        joinedAt: '2026-09-25T00:00:00.000Z',
        status: 'JOINED',
        progress: makeProgress(),
      },
    });
    mockedChallenges.getChallenges
      .mockResolvedValueOnce(makeList(notJoined))
      .mockResolvedValue(makeList(joined));
    mockedChallenges.joinChallenge.mockResolvedValue({
      challengeId: 'c1',
      joined: true,
      alreadyJoined: false,
    });

    renderChallenges();

    fireEvent.click(await screen.findByRole('button', { name: 'Join Expense Tracking Week' }));

    await waitFor(() =>
      expect(mockedChallenges.joinChallenge).toHaveBeenCalledWith('c1')
    );
    expect(
      await screen.findByTestId('challenge-progress-Expense Tracking Week')
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Join Expense Tracking Week' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave Expense Tracking Week' })).toBeDefined();
  });

  it('leaves a joined challenge after confirmation', async () => {
    const joined = makeChallenge({
      participation: {
        joined: true,
        joinedAt: '2026-09-20T00:00:00.000Z',
        status: 'JOINED',
        progress: makeProgress(),
      },
    });
    mockedChallenges.getChallenges
      .mockResolvedValueOnce(makeList(joined))
      .mockResolvedValue(makeList(makeChallenge()));
    mockedChallenges.leaveChallenge.mockResolvedValue({
      challengeId: 'c1',
      left: true,
      wasJoined: true,
    });

    renderChallenges();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Leave Expense Tracking Week' })
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Leave challenge?')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(mockedChallenges.leaveChallenge).toHaveBeenCalledWith('c1')
    );
    expect(
      await screen.findByRole('button', { name: 'Join Expense Tracking Week' })
    ).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('links a habit to an unmapped requirement', async () => {
    const unmappedProgress = makeProgress({
      requirements: [
        {
          requirementId: 'r1',
          name: 'Track expenses',
          frequency: 'DAILY',
          target: 1,
          unit: null,
          mapped: false,
          habitId: null,
          completedPeriods: 0,
          eligiblePeriods: 0,
          completionRate: 0,
        },
      ],
    });
    const mappedProgress = makeProgress({
      requirements: [
        {
          requirementId: 'r1',
          name: 'Track expenses',
          frequency: 'DAILY',
          target: 1,
          unit: null,
          mapped: true,
          habitId: 'h1',
          completedPeriods: 0,
          eligiblePeriods: 0,
          completionRate: 0,
        },
      ],
    });
    mockedChallenges.getChallenges
      .mockResolvedValueOnce(
        makeList(
          makeChallenge({
            participation: {
              joined: true,
              joinedAt: '2026-09-20T00:00:00.000Z',
              status: 'JOINED',
              progress: unmappedProgress,
            },
          })
        )
      )
      .mockResolvedValue(
        makeList(
          makeChallenge({
            participation: {
              joined: true,
              joinedAt: '2026-09-20T00:00:00.000Z',
              status: 'JOINED',
              progress: mappedProgress,
            },
          })
        )
      );
    mockedChallenges.mapChallengeHabit.mockResolvedValue({
      mapping: { requirementId: 'r1', habitId: 'h1' },
    });

    renderChallenges();

    const select = await screen.findByLabelText('Habit for Track expenses');
    fireEvent.change(select, { target: { value: 'h1' } });
    fireEvent.click(screen.getByTestId('challenge-map-Track expenses'));

    await waitFor(() =>
      expect(mockedChallenges.mapChallengeHabit).toHaveBeenCalledWith(
        'c1',
        'r1',
        'h1'
      )
    );
    expect(
      await screen.findByTestId('challenge-mapped-Track expenses')
    ).toHaveTextContent('Daily ledger');
    expect(screen.queryByLabelText('Habit for Track expenses')).toBeNull();
  });

  it('does not offer a join button for upcoming challenges', async () => {
    mockedChallenges.getChallenges.mockResolvedValue(
      makeList(makeChallenge({ status: 'UPCOMING', startDate: '2026-10-05' }))
    );

    renderChallenges();

    expect(
      await screen.findByTestId('challenge-card-Expense Tracking Week')
    ).toBeDefined();
    expect(screen.getByTestId('challenge-status-Expense Tracking Week')).toHaveTextContent(
      'Upcoming'
    );
    expect(screen.getByText(/Opens/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('shows an inline error when the challenge list fails to load and retries', async () => {
    mockedChallenges.getChallenges
      .mockRejectedValueOnce(new Error('Challenges unavailable'))
      .mockResolvedValue(makeList(makeChallenge()));

    renderChallenges();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Challenges unavailable');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByTestId('challenge-card-Expense Tracking Week')
    ).toBeDefined();
    expect(mockedChallenges.getChallenges).toHaveBeenCalledTimes(2);
  });

  it('shows an inline error when joining fails', async () => {
    mockedChallenges.getChallenges.mockResolvedValue(makeList(makeChallenge()));
    mockedChallenges.joinChallenge.mockRejectedValue(
      new Error('Challenge is not active')
    );

    renderChallenges();

    fireEvent.click(await screen.findByRole('button', { name: 'Join Expense Tracking Week' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Challenge is not active'
    );
    expect(
      screen.getByRole('button', { name: 'Join Expense Tracking Week' })
    ).toBeDefined();
  });
});
