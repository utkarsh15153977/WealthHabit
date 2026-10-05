import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Register } from './Register';
import { useAuth } from '../context/useAuth';

vi.mock('../context/useAuth', () => ({
  useAuth: vi.fn(),
}));

const registerMock = vi.fn();

let currentLocation = { pathname: '', search: '' };

function LocationProbe() {
  const location = useLocation();
  currentLocation = { pathname: location.pathname, search: location.search };
  return <div>Verify Email Page</div>;
}

function mockAuth(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    register: registerMock,
    user: null,
    isAuthenticated: false,
    isLoading: false,
    logout: vi.fn(),
    updateUser: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAuth>);
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<LocationProbe />} />
        <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  registerMock.mockReset();
  mockAuth();
});

/** Fills the whole form and submits it, so `register` actually runs. */
function submitValidForm(): void {
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Lovelace' } });
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'ada@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'Str0ngPassword!23' },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: 'Str0ngPassword!23' },
  });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
}

describe('Register page', () => {
  it('sends a newly registered user to the verification step', async () => {
    registerMock.mockResolvedValue(undefined);

    renderRegister();
    submitValidForm();

    // The account is usable immediately, so this is a redirect to finish
    // setup — not a gate.
    expect(await screen.findByText('Verify Email Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });

  it('never places the registered address in the URL', async () => {
    registerMock.mockResolvedValue(undefined);

    renderRegister();
    submitValidForm();

    await screen.findByText('Verify Email Page');

    expect(currentLocation.pathname).toBe('/verify-email');
    // The address would otherwise end up in browser history and referrers.
    expect(currentLocation.search).toBe('');
  });

  it('stays put and shows the server error when registration fails', async () => {
    registerMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: { code: 'EMAIL_EXISTS', message: 'exists' } },
      },
    });

    renderRegister();
    submitValidForm();

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.queryByText('Verify Email Page')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
  });
});