import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VerifyEmail } from './VerifyEmail';
import { emailVerificationApi } from '../services/emailVerificationApi';

vi.mock('../services/emailVerificationApi', () => ({
  emailVerificationApi: {
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
  },
}));

const verifyEmailMock = vi.mocked(emailVerificationApi.verifyEmail);
const resendVerificationMock = vi.mocked(emailVerificationApi.resendVerification);

/**
 * Mimics a rejected axios call so `getApiErrorMessage` can read the status and
 * the structured `error.code` the server actually sends.
 */
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
    <MemoryRouter initialEntries={[token ? `/verify-email?token=${token}` : '/verify-email']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
        <Route path="/login" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  verifyEmailMock.mockReset();
  resendVerificationMock.mockReset();
});

describe('VerifyEmail page', () => {
  it('shows a loading state, then success, for a valid token', async () => {
    verifyEmailMock.mockResolvedValue({
      message: 'Email verified successfully.',
      emailVerified: true,
    });

    renderAt('valid-token');

    // Synchronous read: the request has not settled yet, so the spinner is what
    // the user actually sees first. Awaiting here would skip straight past it.
    expect(screen.getByTestId('verify-email-loading')).toBeInTheDocument();

    expect(await screen.findByTestId('verify-email-success')).toBeInTheDocument();
    expect(screen.getByText(/verified successfully/i)).toBeInTheDocument();
    expect(verifyEmailMock).toHaveBeenCalledWith('valid-token');
  });

  it('offers a resend form instead of a spinner when the link is rejected', async () => {
    verifyEmailMock.mockRejectedValue(
      apiError(400, 'EMAIL_VERIFICATION_INVALID', 'This verification link is invalid or has expired.')
    );

    renderAt('stale-token');

    expect(await screen.findByTestId('verify-email-fallback')).toBeInTheDocument();
    expect(screen.getByTestId('verify-email-error')).toHaveTextContent(
      'This verification link is invalid or has expired.'
    );
    expect(verifyEmailMock).toHaveBeenCalledTimes(1);
  });

  it('prompts for a resend without calling the API when the URL carries no token', async () => {
    renderAt();

    expect(await screen.findByTestId('verify-email-fallback')).toBeInTheDocument();
    expect(screen.getByText(/sent a verification link/i)).toBeInTheDocument();
    expect(verifyEmailMock).not.toHaveBeenCalled();
  });

  it('verifies the token exactly once per page load', async () => {
    verifyEmailMock.mockResolvedValue({
      message: 'Email verified successfully.',
      emailVerified: true,
    });

    const { rerender } = renderAt('single-use-token');

    await screen.findByTestId('verify-email-success');

    // A re-render must not re-consume a token that is already spent.
    rerender(
      <MemoryRouter initialEntries={['/verify-email?token=single-use-token']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(verifyEmailMock).toHaveBeenCalledTimes(1);
  });

  it('sends the typed address when resending and reports the generic reply', async () => {
    verifyEmailMock.mockRejectedValue(apiError(400, 'EMAIL_VERIFICATION_INVALID'));
    resendVerificationMock.mockResolvedValue({
      message: 'If your account requires verification, a verification email has been sent.',
    });

    renderAt('stale-token');

    await screen.findByTestId('verify-email-fallback');

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    expect(await screen.findByTestId('resend-success')).toHaveTextContent(
      'If your account requires verification'
    );
    expect(resendVerificationMock).toHaveBeenCalledWith('ada@example.com');
  });

  it('surfaces a resend failure', async () => {
    verifyEmailMock.mockRejectedValue(apiError(400, 'EMAIL_VERIFICATION_INVALID'));
    resendVerificationMock.mockRejectedValue(
      apiError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later')
    );

    renderAt('stale-token');

    await screen.findByTestId('verify-email-fallback');

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    expect(await screen.findByTestId('resend-error')).toHaveTextContent(
      'Too many requests, please try again later'
    );
  });

  it('keeps the resend button disabled until an address is typed', async () => {
    renderAt();

    await screen.findByTestId('verify-email-fallback');

    const button = screen.getByRole('button', { name: /resend verification email/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'ada@example.com' },
    });
    expect(button).toBeEnabled();
  });

  it('starts a cooldown after a successful resend so the button cannot be spammed', async () => {
    verifyEmailMock.mockRejectedValue(apiError(400, 'EMAIL_VERIFICATION_INVALID'));
    resendVerificationMock.mockResolvedValue({ message: 'Sent.' });

    renderAt();

    await screen.findByTestId('verify-email-fallback');

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));

    await screen.findByTestId('resend-success');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resend available in/i })).toBeDisabled();
    });
  });

  it('links a signed-in user onwards to the dashboard', async () => {
    verifyEmailMock.mockResolvedValue({
      message: 'Email verified successfully.',
      emailVerified: true,
    });

    renderAt('valid-token');

    const link = await screen.findByRole('link', { name: /go to dashboard/i });
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});