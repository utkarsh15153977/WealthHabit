import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Subscriptions } from './Subscriptions';
import { subscriptionApi } from '../services/subscriptionApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import type { Subscription, SubscriptionListResponse } from '../types/subscription';

vi.mock('../services/subscriptionApi', () => ({
  subscriptionApi: {
    getSubscriptions: vi.fn(),
    getSubscription: vi.fn(),
    createSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    renewSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
  },
}));

vi.mock('../services/categoryApi', () => ({
  getCategories: vi.fn(),
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

const mockedSubscriptionApi = vi.mocked(subscriptionApi);
const mockedGetCategories = vi.mocked(getCategories);
const mockedGetMyProfile = vi.mocked(getMyProfile);

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    name: 'Streaming',
    categoryId: null,
    category: null,
    amount: 12.5,
    billingCycle: 'MONTHLY',
    nextRenewalDate: '2026-09-30T00:00:00.000Z',
    status: 'ACTIVE',
    dueState: 'UPCOMING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function listResponse(subscriptions: Subscription[]): SubscriptionListResponse {
  return { subscriptions };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Subscriptions />
    </MemoryRouter>
  );
}

async function waitForRefreshIdle(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Refreshing...')).toBeNull();
  });
}

describe('Subscriptions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCategories.mockResolvedValue({ categories: [] });
    mockedGetMyProfile.mockResolvedValue({
      profile: {
        id: 'u1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'USER',
        status: 'ACTIVE',
        financialProfile: {
          currency: 'USD',
          monthlyIncomeTarget: null,
          monthlySavingsTarget: null,
        },
      },
    });
  });

  it('fetches subscriptions exactly once on initial render', async () => {
    mockedSubscriptionApi.getSubscriptions.mockResolvedValue(
      listResponse([makeSubscription()])
    );

    renderPage();

    expect(await screen.findByText('Streaming')).toBeDefined();
    await waitForRefreshIdle();

    expect(mockedSubscriptionApi.getSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockedSubscriptionApi.getSubscriptions).toHaveBeenCalledWith({
      status: undefined,
      month: undefined,
    });
  });

  it('requests the selected status filter exactly once', async () => {
    mockedSubscriptionApi.getSubscriptions.mockResolvedValue(
      listResponse([makeSubscription()])
    );

    renderPage();

    expect(await screen.findByText('Streaming')).toBeDefined();
    await waitForRefreshIdle();
    expect(mockedSubscriptionApi.getSubscriptions).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAUSED' } });

    await waitFor(() => {
      expect(mockedSubscriptionApi.getSubscriptions).toHaveBeenCalledWith({
        status: 'PAUSED',
        month: undefined,
      });
    });
    await waitForRefreshIdle();

    expect(mockedSubscriptionApi.getSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('refetches exactly once after a renewal', async () => {
    mockedSubscriptionApi.getSubscriptions.mockResolvedValue(
      listResponse([makeSubscription()])
    );
    mockedSubscriptionApi.renewSubscription.mockResolvedValue({
      subscription: makeSubscription({ nextRenewalDate: '2026-10-30T00:00:00.000Z' }),
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Renew Streaming' }));

    await waitFor(() => {
      expect(mockedSubscriptionApi.renewSubscription).toHaveBeenCalledWith('sub-1');
    });
    await waitForRefreshIdle();

    expect(mockedSubscriptionApi.getSubscriptions).toHaveBeenCalledTimes(2);
  });
});
