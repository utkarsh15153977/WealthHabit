import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Bills } from './Bills';
import { billApi } from '../services/billApi';
import { getCategories } from '../services/categoryApi';
import { getMyProfile } from '../services/userApi';
import type { Bill, BillListResponse } from '../types/bill';

vi.mock('../services/billApi', () => ({
  billApi: {
    getBills: vi.fn(),
    getBill: vi.fn(),
    createBill: vi.fn(),
    updateBill: vi.fn(),
    deleteBill: vi.fn(),
  },
}));

vi.mock('../services/categoryApi', () => ({
  getCategories: vi.fn(),
}));

vi.mock('../services/userApi', () => ({
  getMyProfile: vi.fn(),
}));

const mockedBillApi = vi.mocked(billApi);
const mockedGetCategories = vi.mocked(getCategories);
const mockedGetMyProfile = vi.mocked(getMyProfile);

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'bill-1',
    name: 'Electricity',
    categoryId: null,
    category: null,
    amount: 90,
    frequency: 'MONTHLY',
    dueDate: '2026-09-25T00:00:00.000Z',
    nextDueDate: '2026-10-25T00:00:00.000Z',
    status: 'PENDING',
    dueState: 'UPCOMING',
    autoPay: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function listResponse(bills: Bill[]): BillListResponse {
  return { bills };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Bills />
    </MemoryRouter>
  );
}

async function waitForRefreshIdle(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Refreshing...')).toBeNull();
  });
}

describe('Bills page', () => {
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

  it('fetches bills exactly once on initial render', async () => {
    mockedBillApi.getBills.mockResolvedValue(listResponse([makeBill()]));

    renderPage();

    expect(await screen.findByText('Electricity')).toBeDefined();
    await waitForRefreshIdle();

    expect(mockedBillApi.getBills).toHaveBeenCalledTimes(1);
    expect(mockedBillApi.getBills).toHaveBeenCalledWith({
      status: undefined,
      month: undefined,
    });
  });

  it('requests the selected status filter exactly once', async () => {
    mockedBillApi.getBills.mockResolvedValue(listResponse([makeBill()]));

    renderPage();

    expect(await screen.findByText('Electricity')).toBeDefined();
    await waitForRefreshIdle();
    expect(mockedBillApi.getBills).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAID' } });

    await waitFor(() => {
      expect(mockedBillApi.getBills).toHaveBeenCalledWith({
        status: 'PAID',
        month: undefined,
      });
    });
    await waitForRefreshIdle();

    expect(mockedBillApi.getBills).toHaveBeenCalledTimes(2);
  });

  it('returns to the unfiltered request when filters are cleared', async () => {
    mockedBillApi.getBills.mockResolvedValue(listResponse([makeBill()]));

    renderPage();

    expect(await screen.findByText('Electricity')).toBeDefined();
    await waitForRefreshIdle();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAID' } });
    await waitFor(() => {
      expect(mockedBillApi.getBills).toHaveBeenCalledWith({
        status: 'PAID',
        month: undefined,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(mockedBillApi.getBills).toHaveBeenLastCalledWith({
        status: undefined,
        month: undefined,
      });
    });
    await waitForRefreshIdle();

    expect(mockedBillApi.getBills).toHaveBeenCalledTimes(3);
  });

  it('retries the initial request exactly once after a failure', async () => {
    mockedBillApi.getBills
      .mockRejectedValueOnce(new Error('Bill service unavailable'))
      .mockResolvedValue(listResponse([makeBill()]));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Bill service unavailable');
    await waitForRefreshIdle();
    expect(mockedBillApi.getBills).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Electricity')).toBeDefined();
    await waitForRefreshIdle();

    expect(mockedBillApi.getBills).toHaveBeenCalledTimes(2);
  });
});
