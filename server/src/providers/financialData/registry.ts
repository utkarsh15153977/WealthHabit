import { FinancialConnectionProvider } from '@prisma/client';
import { AppError } from '../../utils/errors.js';
import { ApiErrorCodes } from '../../types/errorCodes.js';
import { MockFinancialProvider } from './mockProvider.js';
import type { FinancialDataProvider } from './types.js';

function providerNotSupported(): AppError {
  return AppError.badRequest(
    'Financial data provider is not supported',
    undefined,
    ApiErrorCodes.PROVIDER_NOT_SUPPORTED
  );
}

export function getFinancialDataProvider(
  provider: FinancialConnectionProvider
): FinancialDataProvider {
  switch (provider) {
    case FinancialConnectionProvider.MOCK:
      return new MockFinancialProvider();
    default:
      throw providerNotSupported();
  }
}
