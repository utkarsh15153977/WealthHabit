import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPassword } from './ForgotPassword';
import { authApi } from '../services/authApi';

vi.mock('../services/authApi', () => ({
  authApi: {
    forgotPassword: vi.fn(),
  },
}));

const forgotPasswordMock = vi.mocked(authApi.forgotPassword);

const GENERIC_MESSAGE =
  'If an account exists for this email address, a password reset email has been sent.';

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPassword />
    </MemoryRouter>
  );
}

function submitEmail(value: string) {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value } });
  fireEvent.click(screen.getByTestId('forgot-password-submit'));
}

beforeEach(() => {
  forgotPasswordMock.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('ForgotPassword page', () => {
  it('shows the generic message the server returned for a known address', async () => {
    forgotPasswordMock.mockResolvedValue({ message: GENERIC_MESSAGE });

    renderPage();
    submitEmail('person@example.com');

    expect(await screen.findByTestId('forgot-password-sent')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(GENERIC_MESSAGE);
    expect(forgotPasswordMock).toHaveBeenCalledWith({ email: 'person@example.com' });
  });

  it('shows the identical message for an unknown address, revealing nothing', async () => {
    forgotPasswordMock.mockResolvedValue({ message: GENERIC_MESSAGE });

    renderPage();
    submitEmail('nobody@example.com');

    expect(await screen.findByTestId('forgot-password-sent')).toBeInTheDocument();
    // The page must not claim the account exists, and must not deny it either.
    expect(screen.getByRole('status')).toHaveTextContent(GENERIC_MESSAGE);
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/account not found/i)).not.toBeInTheDocument();
  });

  it('states that account existence is never confirmed', async () => {
    renderPage();

    expect(screen.getByText(/never confirm whether an account exists/i)).toBeInTheDocument();
  });

  it('rejects a malformed address without calling the API', async () => {
    renderPage();
    submitEmail('not-an-email');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email address');
    });
    expect(forgotPasswordMock).not.toHaveBeenCalled();
  });

  it('surfaces a rate-limit rejection', async () => {
    forgotPasswordMock.mockRejectedValue(
      apiError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later')
    );

    renderPage();
    submitEmail('person@example.com');

    expect(await screen.findByTestId('forgot-password-error')).toHaveTextContent(
      'Too many requests, please try again later'
    );
    expect(screen.queryByTestId('forgot-password-sent')).not.toBeInTheDocument();
  });

  it('starts a cooldown after a successful request', async () => {
    forgotPasswordMock.mockResolvedValue({ message: GENERIC_MESSAGE });

    renderPage();
    submitEmail('person@example.com');

    await screen.findByTestId('forgot-password-sent');
    expect(screen.getByTestId('forgot-password-try-another')).toBeInTheDocument();
  });

  it('lets the user request a link for a different address', async () => {
    forgotPasswordMock.mockResolvedValue({ message: GENERIC_MESSAGE });

    renderPage();
    submitEmail('first@example.com');
    await screen.findByTestId('forgot-password-sent');

    fireEvent.click(screen.getByTestId('forgot-password-try-another'));

    expect(screen.getByTestId('forgot-password-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-sent')).not.toBeInTheDocument();

    submitEmail('second@example.com');
    await waitFor(() => {
      expect(forgotPasswordMock).toHaveBeenLastCalledWith({ email: 'second@example.com' });
    });
  });

  it('links back to sign in', () => {
    renderPage();

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});