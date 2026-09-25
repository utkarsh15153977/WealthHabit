import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  RefreshCw,
  Repeat,
  Receipt,
  Settings,
  Target,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { NotificationBell } from '../components/NotificationBell';
import { Loading } from '../components/Loading';
import { getApiErrorMessage } from '../services/error';
import { challengeApi } from '../services/challengeApi';
import { habitApi } from '../services/habitApi';
import { formatDate } from '../utils/date';
import type {
  Challenge,
  ChallengeRequirementProgress,
} from '../types/challenge';
import type { Habit, HabitFrequency } from '../types/habit';

const PAGE_SIZE = 50;

const FREQUENCY_LABELS: Record<HabitFrequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};

const STATUS_LABELS: Record<Challenge['status'], string> = {
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
  ENDED: 'Ended',
};

export function Challenges() {
  const { user, logout } = useAuth();

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [joinedCount, setJoinedCount] = useState(0);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<Challenge | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [mappingRequirementId, setMappingRequirementId] = useState<
    string | null
  >(null);
  const [selectedHabits, setSelectedHabits] = useState<
    Record<string, string>
  >({});

  const requestIdRef = useState(() => ({ current: 0 }))[0];
  const hasLoadedOnceRef = useRef(false);

  const fetchChallenges = useCallback(
    async (options: { initial?: boolean } = {}) => {
      const { initial = false } = options;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (initial) {
        setIsLoading(true);
      } else {
        setIsFetching(true);
      }
      setLoadError(null);

      try {
        const [challengeResult, habitResult] = await Promise.all([
          challengeApi.getChallenges({
            pageSize: PAGE_SIZE,
            includeProgress: true,
          }),
          habitApi.getHabits({ active: true, pageSize: PAGE_SIZE }),
        ]);

        if (requestId !== requestIdRef.current) return;

        setChallenges(challengeResult.challenges);
        setActiveCount(challengeResult.activeCount);
        setJoinedCount(challengeResult.joinedCount);
        setHabits(habitResult.habits);
        setHasLoadedOnce(true);
        hasLoadedOnceRef.current = true;
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        setChallenges([]);
        setHabits([]);
        setLoadError(getApiErrorMessage(error));
      } finally {
        if (requestId === requestIdRef.current) {
          if (initial) {
            setIsLoading(false);
          } else {
            setIsFetching(false);
          }
        }
      }
    },
    [requestIdRef]
  );

  useEffect(() => {
    void fetchChallenges({ initial: !hasLoadedOnceRef.current });
  }, [fetchChallenges]);

  useEffect(() => {
    if (!leaveTarget) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLeaving) {
        setLeaveTarget(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [leaveTarget, isLeaving]);

  const handleJoin = useCallback(
    async (challenge: Challenge) => {
      setActionError(null);
      setSuccessMessage(null);
      setPendingId(challenge.id);

      try {
        const result = await challengeApi.joinChallenge(challenge.id);
        setSuccessMessage(
          result.alreadyJoined
            ? `You already joined "${challenge.name}"`
            : `Joined "${challenge.name}"`
        );
        await fetchChallenges();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      } finally {
        setPendingId(null);
      }
    },
    [fetchChallenges]
  );

  const confirmLeave = useCallback(async () => {
    if (!leaveTarget) return;

    setIsLeaving(true);
    setActionError(null);

    try {
      await challengeApi.leaveChallenge(leaveTarget.id);
      setLeaveTarget(null);
      setSuccessMessage(`Left "${leaveTarget.name}"`);
      await fetchChallenges();
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsLeaving(false);
    }
  }, [leaveTarget, fetchChallenges]);

  const handleMapHabit = useCallback(
    async (challenge: Challenge, requirementId: string) => {
      const habitId = selectedHabits[requirementId];
      if (!habitId) {
        setActionError('Select a habit to link');
        return;
      }

      setActionError(null);
      setSuccessMessage(null);
      setMappingRequirementId(requirementId);

      try {
        await challengeApi.mapChallengeHabit(challenge.id, requirementId, habitId);
        setSuccessMessage(`Habit linked to "${challenge.name}"`);
        await fetchChallenges();
      } catch (error) {
        setActionError(getApiErrorMessage(error));
      } finally {
        setMappingRequirementId(null);
      }
    },
    [selectedHabits, fetchChallenges]
  );

  const groupByStatus = (status: Challenge['status']) =>
    challenges.filter((challenge) => challenge.status === status);

  const activeChallenges = groupByStatus('ACTIVE');
  const upcomingChallenges = groupByStatus('UPCOMING');
  const endedChallenges = groupByStatus('ENDED');

  const showEmpty = hasLoadedOnce && !isLoading && !loadError && challenges.length === 0;

  const habitNameById = (habitId: string | null): string => {
    if (!habitId) return '';
    return habits.find((habit) => habit.id === habitId)?.name ?? 'Linked habit';
  };

  const renderChallengeCard = (challenge: Challenge) => {
    const participation = challenge.participation;
    const progress = participation.progress;
    const isPending = pendingId === challenge.id;
    const isCompleted = progress?.completed === true;

    return (
      <div
        key={challenge.id}
        className="card"
        data-testid={`challenge-card-${challenge.name}`}
      >
        <div className="card-body">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h2 className="heading-4 truncate">{challenge.name}</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {challenge.requirements
                  .map(
                    (requirement) =>
                      `${FREQUENCY_LABELS[requirement.frequency]}${
                        requirement.target > 1 ? ` · ${requirement.target}×` : ''
                      }`
                  )
                  .join(' · ')}
                {challenge.points > 0 ? ` · ${challenge.points} pts` : ''}
              </p>
            </div>
            <span
              className="badge"
              data-testid={`challenge-status-${challenge.name}`}
            >
              {STATUS_LABELS[challenge.status]}
            </span>
          </div>

          {challenge.description && (
            <p className="text-sm text-text-muted mb-3">{challenge.description}</p>
          )}

          <p className="text-sm text-text mb-3">
            {formatDate(challenge.startDate)} — {formatDate(challenge.endDate)}
          </p>

          <ul className="text-sm space-y-1 mb-4">
            {challenge.requirements.map((requirement) => (
              <li key={requirement.id} className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                <span className="text-text truncate">
                  {requirement.name}
                  <span className="text-text-muted">
                    {' '}
                    · {FREQUENCY_LABELS[requirement.frequency]}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {participation.joined && progress && (
            <div className="mb-4" data-testid={`challenge-progress-${challenge.name}`}>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>Progress</span>
                <span>{progress.completionRate}%</span>
              </div>
              <div
                className="h-2 w-full rounded-full bg-border overflow-hidden"
                role="progressbar"
                aria-label={`Progress for ${challenge.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.completionRate}
              >
                <div
                  className={`h-full rounded-full ${isCompleted ? 'bg-success' : 'bg-primary'}`}
                  style={{ width: `${progress.completionRate}%` }}
                />
              </div>
              <p className="text-xs text-text-muted mt-1">
                {progress.completedPeriods} / {progress.eligiblePeriods} periods
              </p>
            </div>
          )}

          {participation.joined && progress && (
            <ul className="space-y-2 mb-4 text-sm">
              {progress.requirements.map(
                (requirement: ChallengeRequirementProgress) => {
                  const isMapping =
                    mappingRequirementId === requirement.requirementId;
                  const candidates = habits.filter(
                    (habit) => habit.frequency === requirement.frequency
                  );
                  const selected =
                    selectedHabits[requirement.requirementId] ?? '';

                  return (
                    <li
                      key={requirement.requirementId}
                      className="rounded-lg border border-border px-3 py-2"
                      data-testid={`challenge-requirement-${requirement.name}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{requirement.name}</span>
                        <span className="text-xs text-text-muted whitespace-nowrap">
                          {requirement.completedPeriods}/
                          {requirement.eligiblePeriods}
                        </span>
                      </div>
                      {requirement.mapped ? (
                        <p
                          className="text-xs text-success mt-1 inline-flex items-center gap-1"
                          data-testid={`challenge-mapped-${requirement.name}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          {habitNameById(requirement.habitId)}
                        </p>
                      ) : (
                        <div className="flex items-center gap-2 mt-2">
                          <select
                            className="input py-1.5 text-xs flex-1"
                            aria-label={`Habit for ${requirement.name}`}
                            value={selected}
                            onChange={(event) =>
                              setSelectedHabits((current) => ({
                                ...current,
                                [requirement.requirementId]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select a habit</option>
                            {candidates.map((habit) => (
                              <option key={habit.id} value={habit.id}>
                                {habit.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() =>
                              void handleMapHabit(challenge, requirement.requirementId)
                            }
                            disabled={isMapping || !selected}
                            data-testid={`challenge-map-${requirement.name}`}
                          >
                            {isMapping ? 'Linking...' : 'Link'}
                          </button>
                        </div>
                      )}
                      {!requirement.mapped && candidates.length === 0 && (
                        <p className="text-xs text-text-muted mt-1">
                          Create a {FREQUENCY_LABELS[requirement.frequency].toLowerCase()}{' '}
                          habit first.
                        </p>
                      )}
                    </li>
                  );
                }
              )}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border">
            {participation.joined && isCompleted && (
              <span className="badge badge-success inline-flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                Completed
              </span>
            )}
            {participation.joined ? (
              <button
                type="button"
                className="btn-ghost btn-sm text-error hover:bg-red-50"
                aria-label={`Leave ${challenge.name}`}
                onClick={() => setLeaveTarget(challenge)}
                disabled={isPending}
              >
                Leave
              </button>
            ) : challenge.status === 'ACTIVE' ? (
              <button
                type="button"
                className="btn-primary btn-sm"
                aria-label={`Join ${challenge.name}`}
                onClick={() => void handleJoin(challenge)}
                disabled={isPending}
                data-testid={`challenge-join-${challenge.name}`}
              >
                {isPending ? 'Joining...' : 'Join Challenge'}
              </button>
            ) : challenge.status === 'UPCOMING' ? (
              <span className="text-xs text-text-muted">
                Opens {formatDate(challenge.startDate)}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading && !hasLoadedOnce) {
    return <Loading />;
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, current: false },
    { name: 'Transactions', href: '/transactions', icon: CreditCard, current: false },
    { name: 'Budgets', href: '/budgets', icon: Target, current: false },
    { name: 'Recurring', href: '/recurring-transactions', icon: Repeat, current: false },
    { name: 'Bills', href: '/bills', icon: Receipt, current: false },
    { name: 'Subscriptions', href: '/subscriptions', icon: RefreshCw, current: false },
    { name: 'Habits', href: '/habits', icon: ListChecks, current: false },
    { name: 'Challenges', href: '/challenges', icon: Trophy, current: true },
    { name: 'Analytics', href: '#', icon: TrendingUp, current: false },
    { name: 'Settings', href: '/profile', icon: Settings, current: false },
  ];

  return (
    <div className="page-container">
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-8 h-8 text-primary" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path
                d="M8 16L14 22L24 10"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-xl font-bold text-text">WealthHabit</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  item.current
                    ? 'bg-primary-light text-primary'
                    : 'text-text-muted hover:bg-background hover:text-text'
                }`}
                aria-current={item.current ? 'page' : undefined}
              >
                <item.icon className="w-4 h-4 inline mr-2" aria-hidden="true" />
                {item.name}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-text-muted">
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </span>
            <NotificationBell />
            <button
              type="button"
              className="btn-ghost p-2"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="page-content">
        <div className="mb-8">
          <h1 className="heading-1 flex items-center gap-2">
            <Trophy className="w-6 h-6" aria-hidden="true" />
            Financial Challenges
          </h1>
          <p className="text-text-muted mt-1">
            Join a challenge and build better money habits together. Joining a challenge
            never creates transactions or changes your budgets.
          </p>
          <p className="text-sm text-text-muted mt-2">
            <span data-testid="challenges-active-count">
              {activeCount} active
            </span>
            {' · '}
            <span data-testid="challenges-joined-count">
              {joinedCount} joined
            </span>
          </p>
        </div>

        {successMessage && (
          <div
            className="rounded-lg border border-success bg-green-50 px-4 py-3 text-sm text-success mb-6"
            role="status"
          >
            {successMessage}
          </div>
        )}

        {actionError && (
          <div
            className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-6"
            role="alert"
          >
            {actionError}
          </div>
        )}

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
                onClick={() => void fetchChallenges({ initial: true })}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {showEmpty && (
          <div className="card">
            <div className="card-body text-center py-16">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-primary-light flex items-center justify-center">
                <Trophy className="w-8 h-8 text-primary" aria-hidden="true" />
              </div>
              <h2 className="heading-2 mb-3">No challenges yet</h2>
              <p className="text-text-muted mb-8 max-w-md mx-auto">
                Check back soon for financial challenges like a 7-day expense tracking
                streak. Challenges are created by the WealthHabit team.
              </p>
              <Link to="/habits" className="btn-primary">
                <CalendarCheck className="w-4 h-4" aria-hidden="true" />
                Explore habits
              </Link>
            </div>
          </div>
        )}

        {!loadError && challenges.length > 0 && (
          <>
            {activeChallenges.length > 0 && (
              <section aria-labelledby="active-challenges-heading" className="mb-8">
                <h2 id="active-challenges-heading" className="heading-3 mb-4">
                  Active challenges
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {activeChallenges.map(renderChallengeCard)}
                </div>
              </section>
            )}

            {upcomingChallenges.length > 0 && (
              <section aria-labelledby="upcoming-challenges-heading" className="mb-8">
                <h2 id="upcoming-challenges-heading" className="heading-3 mb-4">
                  Upcoming challenges
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {upcomingChallenges.map(renderChallengeCard)}
                </div>
              </section>
            )}

            {endedChallenges.length > 0 && (
              <section aria-labelledby="ended-challenges-heading">
                <h2 id="ended-challenges-heading" className="heading-3 mb-4">
                  Ended challenges
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {endedChallenges.map(renderChallengeCard)}
                </div>
              </section>
            )}
          </>
        )}

        {isFetching && hasLoadedOnce && (
          <p className="text-xs text-text-muted text-center mt-4" aria-live="polite">
            Refreshing...
          </p>
        )}
      </main>

      {/* Leave confirmation modal */}
      {leaveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isLeaving && setLeaveTarget(null)}
            aria-hidden="true"
          />
          <div
            className="relative w-full sm:max-w-md bg-surface border border-border rounded-t-xl sm:rounded-xl shadow-lg p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-challenge-title"
            aria-describedby="leave-challenge-description"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <X className="w-5 h-5 text-error" aria-hidden="true" />
              </div>
              <h2 id="leave-challenge-title" className="heading-3">
                Leave challenge?
              </h2>
            </div>
            <p
              id="leave-challenge-description"
              className="text-sm text-text-muted mb-6"
            >
              You will stop tracking progress for{' '}
              <span className="font-medium text-text">{leaveTarget.name}</span>.
              Your habit completions are not affected and you can join again while
              the challenge is active.
            </p>
            {actionError && (
              <div
                className="rounded-lg border border-error bg-red-50 px-4 py-3 text-sm text-error mb-4"
                role="alert"
              >
                {actionError}
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setLeaveTarget(null)}
                disabled={isLeaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void confirmLeave()}
                disabled={isLeaving}
              >
                {isLeaving ? 'Leaving...' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
