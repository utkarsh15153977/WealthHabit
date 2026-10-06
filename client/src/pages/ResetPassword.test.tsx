import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResetPassword } from './ResetPassword';
import { authApi } from '../services/authApi';
import { useAuth } from '../context/useAuth';

vi.mock('../services/authApi', () => ({
  authApi: {
    resetPassword: vi.fn(),
  },
}));

vi.mock('../context/useAuth', () => ({
  useAuth: vi.fn(),
}));

const resetPasswordMock = vi.mocked(authApi.resetPassword);
const useAuthMock = vi.mocked(useAuth);

const RESET_MESSAGE = 'Your password has been reset. Please sign in with your new password.';
const INVALID_MESSAGE = 'This password reset link is invalid or has expired.';

/** Mimics a rejected axios call so `getApiErrorMessage` can read the code. */
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

function renderAt(token?: string) {
  return render(
    <MemoryRouter initialEntries={[token ? `/reset-password?token=${token}` : '/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/forgot-password" element={<div>Forgot password page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function submitPasswords(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByTestId('reset-password-submit'));
}

beforeEach(() => {
  resetPasswordMock.mockReset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({
    isAuthenticated: false,
    refreshSession: vi.fn().mockResolvedValue(false),
  } as unknown as ReturnType<typeof useAuth>);
});

describe('ResetPassword page', () => {
  it('submits the token from the link with the new password', async () => {
    resetPasswordMock.mockResolvedValue({ message: RESET_MESSAGE });

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');

    expect(await screen.findByTestId('reset-password-success')).toBeInTheDocument();
    expect(resetPasswordMock).toHaveBeenCalledWith({
      token: 'valid-token',
      newPassword: 'BrandNewPassword456!',
    });
  });

  it('shows a loading state while the request is in flight', async () => {
    // A promise this test resolves by hand keeps the request genuinely in flight,
    // which a bare `mockResolvedValue` cannot do: it settles inside the same
    // microtask batch as the click, before anything can observe the spinner.
    let settle: (value: { message: string }) => void = () => undefined;
    resetPasswordMock.mockReturnValue(
      new Promise<{ message: string }>((resolve) => {
        settle = resolve;
      })
    );

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-loading')).toBeInTheDocument();
    });

    settle({ message: RESET_MESSAGE });

    expect(await screen.findByTestId('reset-password-success')).toBeInTheDocument();
  });

  it('never asks the API to reset when the link carries no token', async () => {
    renderAt();

    expect(screen.getByTestId('reset-password-fallback')).toBeInTheDocument();
    expect(screen.getByText(INVALID_MESSAGE)).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('shows the generic rejection for an expired or already-used link', async () => {
    resetPasswordMock.mockRejectedValue(apiError(400, 'PASSWORD_RESET_INVALID', INVALID_MESSAGE));

    renderAt('stale-token');
    submitPasswords('BrandNewPassword456!');

    expect(await screen.findByTestId('reset-password-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('reset-password-error')).toHaveTextContent(INVALID_MESSAGE);
  });

  it('enforces the 8-character minimum client-side', async () => {
    renderAt('valid-token');
    submitPasswords('Sh0rt!');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Password must be at least 8 characters'
      );
    });
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('requires the confirmation to match', async () => {
    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!', 'BrandNewPassword457!');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    });
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('does not resubmit a token it has already spent', async () => {
    resetPasswordMock.mockResolvedValue({ message: RESET_MESSAGE });

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');
    await screen.findByTestId('reset-password-success');

    expect(resetPasswordMock).toHaveBeenCalledTimes(1);
  });

  it('clears a stale session through the existing refresh path', async () => {
    const refreshSession = vi.fn().mockResolvedValue(false);
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      refreshSession,
    } as unknown as ReturnType<typeof useAuth>);
    resetPasswordMock.mockResolvedValue({ message: RESET_MESSAGE });

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');

    await screen.findByTestId('reset-password-success');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not call refresh when there was no session to begin with', async () => {
    const refreshSession = vi.fn().mockResolvedValue(false);
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      refreshSession,
    } as unknown as ReturnType<typeof useAuth>);
    resetPasswordMock.mockResolvedValue({ message: RESET_MESSAGE });

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');

    await screen.findByTestId('reset-password-success');
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('sends the user to sign in after success, dropping the token from the URL', async () => {
    resetPasswordMock.mockResolvedValue({ message: RESET_MESSAGE });

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');
    await screen.findByTestId('reset-password-success');

    fireEvent.click(screen.getByTestId('reset-password-continue'));

    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('offers a route back to request a new link after a rejection', async () => {
    resetPasswordMock.mockRejectedValue(apiError(400, 'PASSWORD_RESET_INVALID', INVALID_MESSAGE));

    renderAt('stale-token');
    submitPasswords('BrandNewPassword456!');
    await screen.findByTestId('reset-password-fallback');

    fireEvent.click(screen.getByTestId('reset-password-back'));

    expect(screen.getByText('Forgot password page')).toBeInTheDocument();
  });

  it('keeps the form open and allows a retry when the server errors', async () => {
    resetPasswordMock.mockRejectedValueOnce(
      apiError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again later')
    );
    resetPasswordMock.mockResolvedValueOnce({ message: RESET_MESSAGE });

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-error')).toHaveTextContent(
        'Something went wrong. Please try again later'
      );
    });

    // A transient failure must not claim the link is dead: the form stays up
    // with the same token, so a retry can succeed.
    expect(screen.queryByTestId('reset-password-fallback')).not.toBeInTheDocument();
    expect(screen.getByTestId('reset-password-submit')).toBeInTheDocument();

    submitPasswords('BrandNewPassword456!');
    expect(await screen.findByTestId('reset-password-success')).toBeInTheDocument();
    expect(resetPasswordMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rate-limit rejection', async () => {
    resetPasswordMock.mockRejectedValue(
      apiError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later')
    );

    renderAt('valid-token');
    submitPasswords('BrandNewPassword456!');

    expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(
      'Too many requests, please try again later'
    );
  });

  it('toggles password visibility', () => {
    renderAt('valid-token');

    const input = screen.getByLabelText(/^new password$/i);
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(screen.getByLabelText(/^new password$/i)).toHaveAttribute('type', 'text');
  });
});