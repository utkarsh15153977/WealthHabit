import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from '../src/config/index.js';
import {
  buildPasswordResetUrl,
  buildVerificationUrl,
  clearCapturedEmails,
  getCapturedEmails,
  MemoryEmailTransport,
  sendPasswordResetEmail,
  sendVerificationEmail,
  setEmailTransport,
  type EmailMessage,
} from '../src/services/emailService.js';

const RAW_TOKEN = 'a'.repeat(64);
const EXPIRES_AT = new Date('2030-01-01T00:00:00.000Z');

function params(overrides: Partial<{ to: string; firstName: string; rawToken: string }> = {}) {
  return {
    to: 'user@example.com',
    firstName: 'Ada',
    rawToken: RAW_TOKEN,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

beforeEach(() => {
  clearCapturedEmails();
  setEmailTransport(null);
});

afterEach(() => {
  setEmailTransport(null);
  vi.restoreAllMocks();
});

describe('buildVerificationUrl', () => {
  it('points at the client verify-email page and carries the token once', () => {
    const url = buildVerificationUrl(RAW_TOKEN);

    expect(url).toBe(`${env.CLIENT_URL.replace(/\/+$/, '')}/verify-email?token=${RAW_TOKEN}`);
    expect(url.split('token=')).toHaveLength(2);
  });

  it('percent-encodes a token so it cannot break out of the query string', () => {
    const url = buildVerificationUrl('abc&x=1');

    expect(url).not.toContain('abc&x=1');
    expect(url).toContain('token=abc%26x%3D1');
  });
});

describe('verification email content', () => {
  it('captures the message in memory when the memory transport is active', async () => {
    const result = await sendVerificationEmail(params());

    expect(result).toEqual({ delivered: true, transport: 'memory' });
    expect(getCapturedEmails()).toHaveLength(1);
  });

  it('carries the recipient, sender and a subject with no token in it', async () => {
    await sendVerificationEmail(params());

    const [message] = getCapturedEmails();
    expect(message.to).toBe('user@example.com');
    expect(message.from).toBe(env.EMAIL_FROM);
    expect(message.subject).toContain('Verify');
    expect(message.subject).not.toContain(RAW_TOKEN);
  });

  it('offers the link in both the text and the HTML body', async () => {
    await sendVerificationEmail(params());

    const [message] = getCapturedEmails();
    const url = buildVerificationUrl(RAW_TOKEN);

    expect(message.text).toContain(url);
    expect(message.html).toContain(url);
  });

  it('states the single-use and expiry terms', async () => {
    await sendVerificationEmail(params());

    const [message] = getCapturedEmails();
    expect(message.text).toContain('used once');
    expect(message.text).toContain(EXPIRES_AT.toISOString());
    expect(message.html).toContain('used once');
  });

  it('tells an unexpected recipient that ignoring the email is safe', async () => {
    await sendVerificationEmail(params());

    const [message] = getCapturedEmails();
    expect(message.text).toContain('ignore this email');
  });

  it('escapes a hostile first name instead of injecting markup', async () => {
    await sendVerificationEmail(params({ firstName: '<img src=x onerror="alert(1)">' }));

    const [message] = getCapturedEmails();
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;img src=x');
  });
});

describe('buildPasswordResetUrl', () => {
  it('points at the client reset-password page and carries the token once', () => {
    const url = buildPasswordResetUrl(RAW_TOKEN);

    expect(url).toBe(`${env.CLIENT_URL.replace(/\/+$/, '')}/reset-password?token=${RAW_TOKEN}`);
    expect(url.split('token=')).toHaveLength(2);
  });

  it('percent-encodes a token so it cannot break out of the query string', () => {
    const url = buildPasswordResetUrl('abc&x=1');

    expect(url).not.toContain('abc&x=1');
    expect(url).toContain('token=abc%26x%3D1');
  });
});

describe('password reset email content', () => {
  it('captures the message in memory when the memory transport is active', async () => {
    const result = await sendPasswordResetEmail(params());

    expect(result).toEqual({ delivered: true, transport: 'memory' });
    expect(getCapturedEmails()).toHaveLength(1);
  });

  it('carries the recipient, sender and a subject with no token in it', async () => {
    await sendPasswordResetEmail(params());

    const [message] = getCapturedEmails();
    expect(message.to).toBe('user@example.com');
    expect(message.from).toBe(env.EMAIL_FROM);
    expect(message.subject).toContain('Reset your');
    expect(message.subject).not.toContain(RAW_TOKEN);
  });

  it('offers the link in both the text and the HTML body', async () => {
    await sendPasswordResetEmail(params());

    const [message] = getCapturedEmails();
    const url = buildPasswordResetUrl(RAW_TOKEN);

    expect(message.text).toContain(url);
    expect(message.html).toContain(url);
  });

  it('appears exactly once in the text body so it cannot be re-derived', async () => {
    await sendPasswordResetEmail(params());

    const [message] = getCapturedEmails();
    expect(message.text.split(RAW_TOKEN)).toHaveLength(2);
  });

  it('states the single-use and expiry terms', async () => {
    await sendPasswordResetEmail(params());

    const [message] = getCapturedEmails();
    expect(message.text).toContain('used once');
    expect(message.text).toContain(EXPIRES_AT.toISOString());
    expect(message.html).toContain('used once');
  });

  it('makes the unsolicited case explicit: the password has not changed', async () => {
    await sendPasswordResetEmail(params());

    const [message] = getCapturedEmails();
    expect(message.text).toContain('did not request a password reset');
    expect(message.text).toContain('ignore this email');
    expect(message.html).toContain('has not changed');
  });

  it('never mentions the old or new password', async () => {
    await sendPasswordResetEmail(params());

    const [message] = getCapturedEmails();
    expect(message.text.toLowerCase()).not.toContain('current password');
  });

  it('escapes a hostile first name instead of injecting markup', async () => {
    await sendPasswordResetEmail(params({ firstName: '<img src=x onerror="alert(1)">' }));

    const [message] = getCapturedEmails();
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;img src=x');
  });

  it('reports a provider failure instead of throwing', async () => {
    setEmailTransport({
      name: 'stub-failure',
      send: async () => {
        throw new Error('provider refused the message');
      },
    });

    await expect(sendPasswordResetEmail(params())).resolves.toEqual({
      delivered: false,
      transport: 'stub-failure',
    });
  });
});

describe('delivery failures', () => {
  it('reports failure instead of throwing', async () => {
    setEmailTransport({
      name: 'stub-failure',
      send: async () => {
        throw new Error('provider refused the message');
      },
    });

    await expect(sendVerificationEmail(params())).resolves.toEqual({
      delivered: false,
      transport: 'stub-failure',
    });
  });

  it('never lets a provider error message escape into a thrown error', async () => {
    setEmailTransport({
      name: 'leaky',
      send: async () => {
        throw new Error(`refused payload containing ${RAW_TOKEN}`);
      },
    });

    const result = await sendVerificationEmail(params());

    expect(result.delivered).toBe(false);
  });
});

describe('webhook transport', () => {
  it('posts the message and reports delivery', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    setEmailTransport({
      name: 'webhook',
      send: async (message: EmailMessage) => {
        const response = await fetch('https://mailer.example/hook', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
        });
        if (!response.ok) throw new Error(`webhook responded ${response.status}`);
      },
    });

    const result = await sendVerificationEmail(params());

    expect(result).toEqual({ delivered: true, transport: 'webhook' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('treats a non-2xx webhook response as a delivery failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    setEmailTransport({
      name: 'webhook',
      send: async () => {
        const response = await fetch('https://mailer.example/hook');
        if (!response.ok) throw new Error(`webhook responded ${response.status}`);
      },
    });

    const result = await sendVerificationEmail(params());

    expect(result.delivered).toBe(false);
  });
});

describe('memory transport', () => {
  it('bounds the capture buffer instead of growing without limit', async () => {
    const transport = new MemoryEmailTransport(3);
    setEmailTransport(transport);

    for (let index = 0; index < 10; index += 1) {
      await sendVerificationEmail(params({ to: `user-${index}@example.com` }));
    }

    const captured = transport.list();
    expect(captured).toHaveLength(3);
    // Oldest first: the three most recent sends survive, the rest are dropped.
    expect(captured.map((message) => message.to)).toEqual([
      'user-7@example.com',
      'user-8@example.com',
      'user-9@example.com',
    ]);
  });

  it('keeps messages oldest first', async () => {
    const transport = new MemoryEmailTransport(2);
    setEmailTransport(transport);

    await sendVerificationEmail(params({ to: 'first@example.com' }));
    await sendVerificationEmail(params({ to: 'second@example.com' }));

    expect(getCapturedEmails().map((message) => message.to)).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
  });

  it('hands out copies so a caller cannot mutate the buffer', async () => {
    const transport = new MemoryEmailTransport(1);
    await transport.send({
      to: 'user@example.com',
      from: env.EMAIL_FROM,
      subject: 's',
      text: 't',
      html: 'h',
    });

    const first = transport.list();
    first.push({} as EmailMessage);

    expect(transport.list()).toHaveLength(1);
  });
});