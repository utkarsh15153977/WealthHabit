import { FinancialConnectionProvider } from '@prisma/client';
import { AppError } from '../../utils/errors.js';
import { ApiErrorCodes } from '../../types/errorCodes.js';
import { MockFinancialProvider } from './mockProvider.js';
import type { FinancialDataProvider } from './types.js';

export type FinancialDataProviderFactory = () => FinancialDataProvider;

const providerFactories: Partial<Record<FinancialConnectionProvider, FinancialDataProviderFactory>> = {
  [FinancialConnectionProvider.MOCK]: () => new MockFinancialProvider(),
};

const providerOverrides = new Map<FinancialConnectionProvider, FinancialDataProviderFactory>();

function providerNotSupported(): AppError {
  return AppError.badRequest(
    'Financial data provider is not supported',
    undefined,
    ApiErrorCodes.PROVIDER_NOT_SUPPORTED
  );
}

/**
 * Installs a provider factory for the given provider. Intended for tests that
 * need deterministic provider behavior (for example a provider that always
 * fails) and for future real providers registered by composition root code.
 */
export function setFinancialDataProviderFactory(
  provider: FinancialConnectionProvider,
  factory: FinancialDataProviderFactory
): void {
  providerOverrides.set(provider, factory);
}

export function clearFinancialDataProviderFactories(): void {
  providerOverrides.clear();
}

export function getFinancialDataProvider(
  provider: FinancialConnectionProvider
): FinancialDataProvider {
  const override = providerOverrides.get(provider);
  if (override) {
    return override();
  }
  const factory = providerFactories[provider];
  if (!factory) {
    throw providerNotSupported();
  }
  return factory();
}
