import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Login } from './Login';
import { useAuth } from '../context/useAuth';

vi.mock('../context/useAuth', () => ({
  useAuth: vi.fn(),
}));

const loginMock = vi.fn();
const completeTwoFactorChallengeMock = vi.fn();
const completeTwoFactorRecoveryMock = vi.fn();

const sessionUser = {
  id: 'user-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  emailVerified: true,
};

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

function mockAuth() {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
    login: loginMock,
    completeTwoFactorChallenge: completeTwoFactorChallengeMock,
    completeTwoFactorRecovery: completeTwoFactorRecoveryMock,
    register: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(false),
    updateUser: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<div>Dashboard Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function submitCredentials(): void {
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'Str0ngPassword!23' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

beforeEach(() => {
  loginMock.mockReset();
  completeTwoFactorChallengeMock.mockReset();
  completeTwoFactorRecoveryMock.mockReset();
  mockAuth();
});

describe('Login page', () => {
  it('signs in and navigates to the dashboard without a 2FA challenge', async () => {
    loginMock.mockResolvedValue({ user: sessionUser, accessToken: 'access-1' });

    renderLogin();
    submitCredentials();

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Str0ngPassword!23',
    });
  });

  it('shows the two-factor step when login reports a challenge', async () => {
    loginMock.mockResolvedValue({
      requiresTwoFactor: true as const,
      challengeToken: 'challenge-1',
      expiresInSeconds: 120,
    });

    renderLogin();
    submitCredentials();

    expect(await screen.findByText('Two-factor verification')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('completes a 2FA login with a valid authenticator code', async () => {
    loginMock.mockResolvedValue({
      requiresTwoFactor: true as const,
      challengeToken: 'challenge-1',
      expiresInSeconds: 120,
    });
    completeTwoFactorChallengeMock.mockResolvedValue(sessionUser);

    renderLogin();
    submitCredentials();

    fireEvent.change(await screen.findByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(completeTwoFactorChallengeMock).toHaveBeenCalledWith({
      challengeToken: 'challenge-1',
      code: '123456',
    });
  });

  it('shows the mapped message when the authenticator code is wrong', async () => {
    loginMock.mockResolvedValue({
      requiresTwoFactor: true as const,
      challengeToken: 'challenge-1',
      expiresInSeconds: 120,
    });
    completeTwoFactorChallengeMock.mockRejectedValue(
      apiError(400, 'MFA_CODE_INVALID', 'That authenticator code is invalid or has expired')
    );

    renderLogin();
    submitCredentials();

    fireEvent.change(await screen.findByLabelText(/authenticator code/i), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText(/that authenticator code is invalid or has expired/i)).toBeInTheDocument();
    expect(completeTwoFactorChallengeMock).toHaveBeenCalledWith({
      challengeToken: 'challenge-1',
      code: '000000',
    });
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('falls back to a recovery code and uses it to complete the login', async () => {
    loginMock.mockResolvedValue({
      requiresTwoFactor: true as const,
      challengeToken: 'challenge-1',
      expiresInSeconds: 120,
    });
    completeTwoFactorRecoveryMock.mockResolvedValue(sessionUser);

    renderLogin();
    submitCredentials();

    fireEvent.click(await screen.findByRole('button', { name: /use a recovery code instead/i }));

    fireEvent.change(screen.getByLabelText(/^recovery code$/i), {
      target: { value: 'ABCD-EFGH-IJKL' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(completeTwoFactorRecoveryMock).toHaveBeenCalledWith({
      challengeToken: 'challenge-1',
      recoveryCode: 'ABCD-EFGH-IJKL',
    });
  });

  it('lets the user restart with a different account from the 2FA step', async () => {
    loginMock.mockResolvedValue({
      requiresTwoFactor: true as const,
      challengeToken: 'challenge-1',
      expiresInSeconds: 120,
    });

    renderLogin();
    submitCredentials();

    fireEvent.click(await screen.findByRole('button', { name: /sign in with a different account/i }));

    expect(screen.queryByText('Two-factor verification')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the challenge message honest when the server returns a generic MFA error', async () => {
    loginMock.mockResolvedValue({
      requiresTwoFactor: true as const,
      challengeToken: 'challenge-1',
      expiresInSeconds: 120,
    });
    completeTwoFactorChallengeMock.mockRejectedValue(
      apiError(400, 'MFA_CHALLENGE_INVALID', 'This two-factor verification is invalid or has expired.')
    );

    renderLogin();
    submitCredentials();

    fireEvent.change(await screen.findByLabelText(/authenticator code/i), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText(/this two-factor verification is invalid or has expired/i)).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });
});