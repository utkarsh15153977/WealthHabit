import { describe, it, expect, vi, afterEach } from 'vitest';
import { FinancialConnectionProvider } from '@prisma/client';
import { AppError } from '../../src/utils/errors.js';
import { ApiErrorCodes } from '../../src/types/errorCodes.js';
import { MockFinancialProvider } from '../../src/providers/financialData/mockProvider.js';
import { getFinancialDataProvider } from '../../src/providers/financialData/registry.js';

const envStub = vi.hoisted(() => ({ isProduction: false, isDevelopment: true }));

vi.mock('../../src/config/index.js', () => ({ env: envStub }));

function captureProviderError(provider: FinancialConnectionProvider): AppError {
  try {
    getFinancialDataProvider(provider);
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected getFinancialDataProvider to throw');
}

describe('financial data provider registry', () => {
  afterEach(() => {
    envStub.isProduction = false;
    envStub.isDevelopment = true;
  });

  it('resolves MOCK to a MockFinancialProvider instance', () => {
    const provider = getFinancialDataProvider(FinancialConnectionProvider.MOCK);

    expect(provider).toBeInstanceOf(MockFinancialProvider);
    expect(provider.provider).toBe(FinancialConnectionProvider.MOCK);
  });

  it('rejects ACCOUNT_AGGREGATOR with PROVIDER_NOT_SUPPORTED', () => {
    const error = captureProviderError(FinancialConnectionProvider.ACCOUNT_AGGREGATOR);

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ApiErrorCodes.PROVIDER_NOT_SUPPORTED);
    expect(error.message).toBe('Financial data provider is not supported');
  });

  it('rejects BANK with PROVIDER_NOT_SUPPORTED', () => {
    const error = captureProviderError(FinancialConnectionProvider.BANK);

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ApiErrorCodes.PROVIDER_NOT_SUPPORTED);
    expect(error.message).toBe('Financial data provider is not supported');
  });

  it('rejects unknown provider values', () => {
    const error = captureProviderError('STRIPE' as FinancialConnectionProvider);

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ApiErrorCodes.PROVIDER_NOT_SUPPORTED);
  });

  it('rejects MOCK in production', () => {
    envStub.isProduction = true;
    envStub.isDevelopment = false;

    const error = captureProviderError(FinancialConnectionProvider.MOCK);

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ApiErrorCodes.PROVIDER_NOT_SUPPORTED);
    expect(error.message).toBe('Financial data provider is not supported');
  });

  it('allows MOCK outside production', () => {
    envStub.isProduction = false;
    envStub.isDevelopment = false;

    expect(() => getFinancialDataProvider(FinancialConnectionProvider.MOCK)).not.toThrow();
  });
});
