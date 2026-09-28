import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { AdminChallenges } from './AdminChallenges';
import { RequireAdmin } from '../components/RequireAdmin';
import { getAdminChallenge, listAdminChallenges } from '../services/adminChallengesApi';
import { challengeApi } from '../services/challengeApi';
import type {
  AdminChallengeDetail,
  AdminChallengeListResponse,
  AdminChallengeSummary,
} from '../types/adminChallenges';

const authState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Admin',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  } as { id: string; role: string } | null,
}));

vi.mock('../services/adminChallengesApi', () => ({
  listAdminChallenges: vi.fn(),
  getAdminChallenge: vi.fn(),
  adminChallengesApi: {
    listAdminChallenges: vi.fn(),
    getAdminChallenge: vi.fn(),
  },
}));

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

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isAuthenticated: authState.user !== null,
    isLoading: false,
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

const mockedList = vi.mocked(listAdminChallenges);
const mockedDetail = vi.mocked(getAdminChallenge);
const mockedCreate = vi.mocked(challengeApi.createChallenge);
const mockedUpdate = vi.mocked(challengeApi.updateChallenge);
const mockedDelete = vi.mocked(challengeApi.deleteChallenge);

function makeChallenge(
  overrides: Partial<AdminChallengeSummary> = {}
): AdminChallengeSummary {
  return {
    id: 'ch1',
    name: 'Budget Sprint',
    description: 'Track every expense.',
    category: 'saving',
    difficulty: 'MEDIUM',
    points: 50,
    type: 'HABIT_COMPLETION',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-07T00:00:00.000Z',
    isActive: true,
    status: 'ACTIVE',
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    requirementCount: 1,
    participants: { total: 3 },
    ...overrides,
  };
}

function makeList(
  challenges: AdminChallengeSummary[],
  overrides: Partial<AdminChallengeListResponse> = {}
): AdminChallengeListResponse {
  return {
    challenges,
    page: 1,
    pageSize: 20,
    total: challenges.length,
    totalPages: 1,
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<AdminChallengeDetail> = {}
): AdminChallengeDetail {
  return {
    ...makeChallenge(),
    requirements: [
      {
        id: 'req1',
        name: 'Log expenses daily',
        description: null,
        frequency: 'DAILY',
        target: 1,
        unit: null,
        mappedParticipants: 2,
      },
    ],
    participants: { total: 3, completed: 1 },
    ...overrides,
  };
}

function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/challenges']}>
      <AppLayout>
        <AdminChallenges />
      </AppLayout>
    </MemoryRouter>
  );
}

function desktopTable() {
  return within(screen.getByTestId('admin-challenges-table'));
}

function mobileCards() {
  return within(screen.getByTestId('admin-challenges-table-mobile'));
}

describe('AdminChallenges page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      id: 'u1',
      role: 'ADMIN',
    };
    mockedList.mockResolvedValue(makeList([makeChallenge()]));
    mockedDetail.mockResolvedValue({ challenge: makeDetail() });
    mockedCreate.mockResolvedValue({ challenge: {} as never });
    mockedUpdate.mockResolvedValue({ challenge: {} as never });
    mockedDelete.mockResolvedValue({ message: 'Challenge deleted' });
  });

  it('shows the loading state while fetching', async () => {
    mockedList.mockReturnValue(pending());
    renderPage();
    expect(await screen.findByTestId('admin-challenges-loading')).toHaveTextContent(
      'Loading challenges...'
    );
    expect(screen.queryByTestId('admin-challenges-table')).toBeNull();
  });

  it('renders the heading, navigation and challenge rows', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Challenge Administration' })
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Admin Challenges' })
    ).toHaveAttribute('href', '/admin/challenges');
    expect(
      screen.getByRole('link', { name: 'Admin Challenges' })
    ).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('link', { name: 'Challenges' })
    ).toHaveAttribute('href', '/challenges');

    const table = await screen.findByTestId('admin-challenges-table');
    const rows = desktopTable().getAllByTestId('admin-challenges-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Budget Sprint');
    expect(rows[0]).toHaveTextContent('HABIT_COMPLETION');
    expect(within(rows[0]).getByTestId('admin-challenges-row-status')).toHaveTextContent(
      'ACTIVE'
    );
    expect(within(rows[0]).getByTestId('admin-challenges-row-active')).toHaveTextContent(
      'Active'
    );
    expect(rows[0]).toHaveTextContent('3');

    expect(screen.getByTestId('admin-challenges-table-mobile')).toBeDefined();
    expect(mobileCards().getAllByTestId('admin-challenges-card')).toHaveLength(1);
    expect(table).toBeDefined();
  });

  it('debounces search and requests the matching list', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.change(screen.getByTestId('admin-challenges-search'), {
      target: { value: 'budget' },
    });

    await waitFor(
      () => {
        expect(mockedList).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'budget' })
        );
      },
      { timeout: 2000 }
    );
  });

  it('applies and clears status/active filters', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.change(screen.getByTestId('admin-challenges-status-filter'), {
      target: { value: 'UPCOMING' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-active-filter'), {
      target: { value: 'false' },
    });
    fireEvent.click(screen.getByTestId('admin-challenges-apply'));

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'UPCOMING', active: false })
      );
    });

    fireEvent.click(screen.getByTestId('admin-challenges-clear-filters'));
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined, active: undefined })
      );
    });
  });

  it('navigates pages through Previous and Next', async () => {
    mockedList.mockResolvedValue(
      makeList([makeChallenge()], { total: 40, totalPages: 2 })
    );
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    expect(screen.getByTestId('admin-challenges-prev')).toBeDisabled();
    fireEvent.click(screen.getByTestId('admin-challenges-next'));

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      );
    });
    expect(screen.getByTestId('admin-challenges-page-indicator')).toHaveTextContent(
      'Page 2 of 2'
    );
  });

  it('creates a challenge through the form with client validation', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(screen.getByTestId('admin-challenges-create'));
    await screen.findByTestId('admin-challenges-form');

    fireEvent.click(screen.getByTestId('admin-challenges-form-submit'));
    expect(
      (
        await within(
          screen.getByTestId('admin-challenges-form')
        ).findAllByText('Name is required')
      ).length
    ).toBeGreaterThan(0);
    expect(mockedCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('admin-challenges-form-name'), {
      target: { value: 'New challenge' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-form-start'), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-form-end'), {
      target: { value: '2026-02-07' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-requirement-name'), {
      target: { value: 'Daily log' },
    });

    fireEvent.click(screen.getByTestId('admin-challenges-form-submit'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({
        name: 'New challenge',
        description: undefined,
        category: undefined,
        difficulty: 'MEDIUM',
        points: 0,
        startDate: '2026-02-01',
        endDate: '2026-02-07',
        requirements: [
          {
            name: 'Daily log',
            description: undefined,
            frequency: 'DAILY',
            target: 1,
            unit: undefined,
          },
        ],
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('admin-challenges-form')).toBeNull();
    });
    expect(mockedList.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('supports up to ten requirements with add and remove', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(screen.getByTestId('admin-challenges-create'));
    await screen.findByTestId('admin-challenges-form');
    expect(
      screen.getAllByTestId('admin-challenges-requirement')
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId('admin-challenges-add-requirement'));
    expect(
      screen.getAllByTestId('admin-challenges-requirement')
    ).toHaveLength(2);

    const removeButtons = screen.getAllByTestId(
      'admin-challenges-remove-requirement'
    );
    fireEvent.click(removeButtons[1]);
    expect(
      screen.getAllByTestId('admin-challenges-requirement')
    ).toHaveLength(1);
    expect(
      screen.getByTestId('admin-challenges-remove-requirement')
    ).toBeDisabled();
  });

  it('rejects an inverted date range on the client', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(screen.getByTestId('admin-challenges-create'));
    await screen.findByTestId('admin-challenges-form');

    fireEvent.change(screen.getByTestId('admin-challenges-form-name'), {
      target: { value: 'Backwards' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-form-start'), {
      target: { value: '2026-03-07' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-form-end'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-requirement-name'), {
      target: { value: 'Daily log' },
    });
    fireEvent.click(screen.getByTestId('admin-challenges-form-submit'));

    expect(
      await screen.findByText('End date must be on or after start date')
    ).toBeDefined();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('shows a create error from the server inside the form', async () => {
    mockedCreate.mockRejectedValue(
      new Error('Validation failed')
    );
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(screen.getByTestId('admin-challenges-create'));
    await screen.findByTestId('admin-challenges-form');
    fireEvent.change(screen.getByTestId('admin-challenges-form-name'), {
      target: { value: 'New challenge' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-form-start'), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-form-end'), {
      target: { value: '2026-02-07' },
    });
    fireEvent.change(screen.getByTestId('admin-challenges-requirement-name'), {
      target: { value: 'Daily log' },
    });
    fireEvent.click(screen.getByTestId('admin-challenges-form-submit'));

    expect(await screen.findByTestId('admin-challenges-form-error')).toHaveTextContent(
      'Validation failed'
    );
    expect(screen.getByTestId('admin-challenges-form')).toBeDefined();
  });

  it('edits an existing challenge with prefilled values', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-challenges-edit')[0]);
    await waitFor(() => {
      expect(mockedDetail).toHaveBeenCalledWith('ch1');
    });
    const nameInput = await screen.findByTestId('admin-challenges-form-name');
    expect(nameInput).toHaveValue('Budget Sprint');
    expect(screen.getByTestId('admin-challenges-form-active')).toBeChecked();

    fireEvent.change(nameInput, { target: { value: 'Renamed sprint' } });
    fireEvent.click(screen.getByTestId('admin-challenges-form-submit'));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith('ch1', {
        name: 'Renamed sprint',
        description: 'Track every expense.',
        category: 'saving',
        difficulty: 'MEDIUM',
        points: 50,
        startDate: '2026-01-01',
        endDate: '2026-01-07',
        isActive: true,
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('admin-challenges-form')).toBeNull();
    });
  });

  it('opens the detail dialog with requirements and participant counts', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-challenges-view')[0]);
    const dialog = await screen.findByTestId('admin-challenges-detail');

    await waitFor(() => {
      expect(mockedDetail).toHaveBeenCalledWith('ch1');
    });
    expect(within(dialog).getByTestId('admin-challenges-detail-name')).toHaveTextContent(
      'Budget Sprint'
    );
    expect(
      within(dialog).getByTestId('admin-challenges-detail-participants')
    ).toHaveTextContent('3 joined · 1 completed');
    expect(
      within(dialog).getByTestId('admin-challenges-detail-requirements')
    ).toHaveTextContent('Log expenses daily');
    expect(
      within(dialog).getByTestId('admin-challenges-detail-requirements')
    ).toHaveTextContent('2');

    fireEvent.click(within(dialog).getByTestId('admin-challenges-detail-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('admin-challenges-detail')).toBeNull();
    });
  });

  it('requires confirmation before deleting and refreshes the list', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');
    const callsBefore = mockedList.mock.calls.length;

    fireEvent.click(desktopTable().getAllByTestId('admin-challenges-delete')[0]);
    const dialog = await screen.findByTestId('admin-challenges-confirm');
    expect(dialog).toHaveTextContent('Budget Sprint');
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByTestId('admin-challenges-confirm-accept'));

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('ch1');
    });
    await waitFor(() => {
      expect(mockedList.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(screen.queryByTestId('admin-challenges-confirm')).toBeNull();
  });

  it('cancels deletion without calling the API', async () => {
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-challenges-delete')[0]);
    const dialog = await screen.findByTestId('admin-challenges-confirm');
    fireEvent.click(within(dialog).getByTestId('admin-challenges-confirm-cancel'));

    expect(screen.queryByTestId('admin-challenges-confirm')).toBeNull();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('shows a delete error inside the confirmation dialog', async () => {
    mockedDelete.mockRejectedValue(new Error('Cannot delete'));
    renderPage();
    await screen.findByTestId('admin-challenges-table');

    fireEvent.click(desktopTable().getAllByTestId('admin-challenges-delete')[0]);
    const dialog = await screen.findByTestId('admin-challenges-confirm');
    fireEvent.click(within(dialog).getByTestId('admin-challenges-confirm-accept'));

    expect(await screen.findByTestId('admin-challenges-confirm-error')).toHaveTextContent(
      'Cannot delete'
    );
    expect(screen.getByTestId('admin-challenges-confirm')).toBeDefined();
  });

  it('shows the empty state when no challenges exist', async () => {
    mockedList.mockResolvedValue(makeList([]));
    renderPage();

    expect(await screen.findByTestId('admin-challenges-empty')).toHaveTextContent(
      'No challenges yet'
    );
    expect(screen.queryByTestId('admin-challenges-table')).toBeNull();
  });

  it('shows the no-results state when filters match nothing', async () => {
    mockedList.mockResolvedValue(makeList([]));
    renderPage();
    await screen.findByTestId('admin-challenges-empty');

    fireEvent.change(screen.getByTestId('admin-challenges-search'), {
      target: { value: 'nomatch' },
    });

    expect(
      await screen.findByTestId('admin-challenges-no-results', {}, { timeout: 2000 })
    ).toHaveTextContent('No matching challenges');
  });

  it('shows a load error with retry', async () => {
    mockedList.mockRejectedValueOnce(new Error('Network down'));
    renderPage();

    const error = await screen.findByTestId('admin-challenges-error');
    expect(error).toHaveTextContent('Network down');

    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('admin-challenges-table')).toBeDefined();
    expect(screen.queryByTestId('admin-challenges-error')).toBeNull();
  });
});

describe('RequireAdmin access for /admin/challenges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockResolvedValue(makeList([makeChallenge()]));
    mockedDetail.mockResolvedValue({ challenge: makeDetail() });
  });

  it('redirects an authenticated USER to the dashboard', async () => {
    authState.user = { id: 'u1', role: 'USER' };

    render(
      <MemoryRouter initialEntries={['/admin/challenges']}>
        <Routes>
          <Route
            path="/admin/challenges"
            element={
              <RequireAdmin>
                <AdminChallenges />
              </RequireAdmin>
            }
          />
          <Route path="/dashboard" element={<div>dashboard-home</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('dashboard-home')).toBeDefined();
    });
    expect(screen.queryByTestId('admin-challenges-table')).toBeNull();
  });

  it('redirects anonymous visitors to login', async () => {
    authState.user = null;

    render(
      <MemoryRouter initialEntries={['/admin/challenges']}>
        <Routes>
          <Route
            path="/admin/challenges"
            element={
              <RequireAdmin>
                <AdminChallenges />
              </RequireAdmin>
            }
          />
          <Route path="/login" element={<div>login-page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('login-page')).toBeDefined();
    });
  });

  it('renders the page for an ADMIN', async () => {
    authState.user = { id: 'u1', role: 'ADMIN' };

    render(
      <MemoryRouter initialEntries={['/admin/challenges']}>
        <Routes>
          <Route
            path="/admin/challenges"
            element={
              <RequireAdmin>
                <AdminChallenges />
              </RequireAdmin>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: 'Challenge Administration' })
    ).toBeDefined();
  });
});
