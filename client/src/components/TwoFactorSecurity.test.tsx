import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TwoFactorSecurity } from './TwoFactorSecurity';
import { authApi } from '../services/authApi';

vi.mock('../services/authApi', () => ({
  authApi: {
    getMfaStatus: vi.fn(),
    setupMfa: vi.fn(),
    enableMfa: vi.fn(),
    disableMfa: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
  },
}));

const getMfaStatusMock = vi.mocked(authApi.getMfaStatus);
const setupMfaMock = vi.mocked(authApi.setupMfa);
const enableMfaMock = vi.mocked(authApi.enableMfa);
const disableMfaMock = vi.mocked(authApi.disableMfa);
const regenerateRecoveryCodesMock = vi.mocked(authApi.regenerateRecoveryCodes);

const recoveryCodes = [
  'AAAA-BBBB-CCCC',
  'DDDD-EEEE-FFFF',
  'GGGG-HHHH-IIII',
  'JJJJ-KKKK-LLLL',
  'MMMM-NNNN-OOOO',
  'PPPP-QQQQ-RRRR',
  'SSSS-TTTT-UUUU',
  'VVVV-WWWW-XXXX',
  'YYYY-ZZZZ-1111',
  '2222-3333-4444',
];

function apiError(status: number, code?: string, message?: string) {
  return {
    isAxiosError: true,
    message: 'Request failed',
    response: {
      status,
      data: code ? { error: { code, message } } : {},
    },
  };
}

beforeEach(() => {
  getMfaStatusMock.mockReset();
  setupMfaMock.mockReset();
  enableMfaMock.mockReset();
  disableMfaMock.mockReset();
  regenerateRecoveryCodesMock.mockReset();
});

describe('TwoFactorSecurity card', () => {
  it('offers to turn 2FA on when the account has none', async () => {
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: false, setupPending: false });

    render(<TwoFactorSecurity />);

    expect(await screen.findByTestId('mfa-setup')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-status-disabled')).toBeInTheDocument();
  });

  it('shows the enabled actions when 2FA is on', async () => {
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: true, setupPending: false });

    render(<TwoFactorSecurity />);

    expect(await screen.findByTestId('mfa-status-enabled')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-disable')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-regenerate-codes')).toBeInTheDocument();
  });

  it('runs the whole enrollment: password, QR, code, then recovery codes', async () => {
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: false, setupPending: false });
    setupMfaMock.mockResolvedValue({
      secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      otpauthUri: 'otpauth://totp/WealthHabit:ada%40example.com?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      expiresAt: '2026-10-06T00:00:00.000Z',
    });
    enableMfaMock.mockResolvedValue({ recoveryCodes });

    render(<TwoFactorSecurity />);

    fireEvent.click(await screen.findByTestId('mfa-setup'));

    fireEvent.change(await screen.findByLabelText(/^password$/i), {
      target: { value: 'Str0ngPassword!23' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(setupMfaMock).toHaveBeenCalledWith({ password: 'Str0ngPassword!23' }));
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent(
      'ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567'
    );

    fireEvent.click(screen.getByRole('button', { name: /i've scanned the code/i }));

    fireEvent.change(await screen.findByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enable two-factor authentication/i }));

    await waitFor(() => expect(enableMfaMock).toHaveBeenCalledWith({ code: '123456' }));
    expect(await screen.findByTestId('mfa-recovery-codes')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-recovery-codes').children).toHaveLength(recoveryCodes.length);

    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: true, setupPending: false });
    fireEvent.click(screen.getByTestId('mfa-codes-done'));

    expect(await screen.findByTestId('mfa-status-enabled')).toBeInTheDocument();
  });

  it('surfaces a password failure during enrollment', async () => {
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: false, setupPending: false });
    setupMfaMock.mockRejectedValue(
      apiError(400, 'PASSWORD_UNVERIFIED', 'Your password could not be verified. Please try again')
    );

    render(<TwoFactorSecurity />);

    fireEvent.click(await screen.findByTestId('mfa-setup'));
    fireEvent.change(await screen.findByLabelText(/^password$/i), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText(/your password could not be verified/i)).toBeInTheDocument();
    expect(screen.queryByTestId('mfa-secret')).not.toBeInTheDocument();
  });

  it('disables 2FA after re-authentication', async () => {
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: true, setupPending: false });
    disableMfaMock.mockResolvedValue({ message: 'Two-factor authentication has been disabled.' });

    render(<TwoFactorSecurity />);

    fireEvent.click(await screen.findByTestId('mfa-disable'));

    fireEvent.change(await screen.findByLabelText(/^password$/i), {
      target: { value: 'Str0ngPassword!23' },
    });
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: false, setupPending: false });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(disableMfaMock).toHaveBeenCalledWith({ password: 'Str0ngPassword!23', code: '123456' })
    );

    expect(await screen.findByTestId('mfa-setup')).toBeInTheDocument();
  });

  it('mints new recovery codes and shows them exactly once', async () => {
    getMfaStatusMock.mockResolvedValue({ twoFactorEnabled: true, setupPending: false });
    regenerateRecoveryCodesMock.mockResolvedValue({ recoveryCodes });

    render(<TwoFactorSecurity />);

    fireEvent.click(await screen.findByTestId('mfa-regenerate-codes'));

    fireEvent.change(await screen.findByLabelText(/^password$/i), {
      target: { value: 'Str0ngPassword!23' },
    });
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(regenerateRecoveryCodesMock).toHaveBeenCalledWith({
        password: 'Str0ngPassword!23',
        code: '123456',
      })
    );
    expect(await screen.findByTestId('mfa-recovery-codes')).toBeInTheDocument();
    const list = screen.getByTestId('mfa-recovery-codes');
    expect(list.querySelectorAll('li')).toHaveLength(recoveryCodes.length);
    expect(list).toHaveTextContent('AAAA-BBBB-CCCC');
  });
});