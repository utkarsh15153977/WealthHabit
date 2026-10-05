import { env } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * One delivery mechanism. Deliberately the narrowest possible contract so an
 * operator can plug in an SMTP relay, a transactional HTTP API or a queue
 * producer without the authentication flow ever importing a provider SDK.
 */
export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

const BRAND = 'WealthHabit';

/**
 * Development/test transport.
 *
 * Messages are captured in process memory (bounded ring buffer) and nothing
 * leaves the server, so the verification flow can be exercised end to end
 * without a real provider, credentials or outbound network. It logs only the
 * recipient and subject: the body contains the verification link, so logging it
 * would put a live token in the logs.
 *
 * This transport is NOT a production delivery mechanism — see
 * `resolveEmailTransport` in `config/index.ts`, which warns at start-up when
 * production is configured with it.
 */
export class MemoryEmailTransport implements EmailTransport {
  readonly name = 'memory';

  private readonly captured: EmailMessage[] = [];

  constructor(private readonly limit = 50) {}

  async send(message: EmailMessage): Promise<void> {
    this.captured.push(message);

    if (this.captured.length > this.limit) {
      this.captured.splice(0, this.captured.length - this.limit);
    }

    logger.info('email captured in memory (no delivery)', {
      transport: this.name,
      to: message.to,
      subject: message.subject,
    });
  }

  list(): EmailMessage[] {
    return [...this.captured];
  }

  clear(): void {
    this.captured.length = 0;
  }
}

/**
 * Operator-provided HTTP delivery endpoint.
 *
 * The message is POSTed as JSON and, when configured, authenticated with a
 * bearer credential. Nothing about the provider is assumed here — the operator
 * points `EMAIL_WEBHOOK_URL` at whatever they operate (a small relay service, a
 * serverless function, an internal mail gateway).
 *
 * Failures throw so the caller can decide what to do; no response body and no
 * message content is ever logged, because the body echoes the verification
 * token back to whoever holds the URL.
 */
class WebhookEmailTransport implements EmailTransport {
  readonly name = 'webhook';

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs = 10_000
  ) {}

  async send(message: EmailMessage): Promise<void> {
    if (!this.url) {
      throw new Error('EMAIL_WEBHOOK_URL is not configured for the webhook email transport');
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Email webhook responded with HTTP ${response.status}`);
    }
  }
}

function createTransport(): EmailTransport {
  if (env.EMAIL_TRANSPORT === 'webhook') {
    return new WebhookEmailTransport(env.EMAIL_WEBHOOK_URL, env.EMAIL_WEBHOOK_TOKEN);
  }

  return new MemoryEmailTransport();
}

let transport: EmailTransport | null = null;

function getTransport(): EmailTransport {
  transport ??= createTransport();
  return transport;
}

/** Test seam: inject a transport, or reset to the configured one. */
export function setEmailTransport(next: EmailTransport | null): void {
  transport = next;
}

/**
 * Captured messages from the memory transport, oldest first. Only meaningful
 * while the memory transport is active; exposed so tests can assert on delivery
 * without a provider.
 */
export function getCapturedEmails(): EmailMessage[] {
  const active = getTransport();
  return active instanceof MemoryEmailTransport ? active.list() : [];
}

export function clearCapturedEmails(): void {
  const active = getTransport();
  if (active instanceof MemoryEmailTransport) {
    active.clear();
  }
}

/**
 * Builds the single-use link the user clicks. The raw token appears in the URL
 * and nowhere else — it is never placed in a subject, a log line or an audit
 * row.
 */
export function buildVerificationUrl(rawToken: string): string {
  return `${env.CLIENT_URL.replace(/\/+$/, '')}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

export interface VerificationEmailParams {
  to: string;
  firstName: string;
  rawToken: string;
  expiresAt: Date;
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toISOString();
}

function renderVerificationEmail(params: VerificationEmailParams): Omit<EmailMessage, 'to' | 'from'> {
  const { firstName, rawToken, expiresAt } = params;
  const url = buildVerificationUrl(rawToken);
  const expiry = formatExpiry(expiresAt);

  const subject = `Verify your ${BRAND} email address`;

  const text = [
    `Hi ${firstName},`,
    '',
    `Thanks for creating your ${BRAND} account. Confirm that this email address belongs to you by opening the link below:`,
    '',
    url,
    '',
    `This link can be used once and expires at ${expiry}.`,
    '',
    'If the link does not work, open ' +
      `${env.CLIENT_URL.replace(/\/+$/, '')}/verify-email and request a new verification email.`,
    '',
    `If you did not create a ${BRAND} account, you can ignore this email — nothing has changed.`,
    '',
    '— The WealthHabit team',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e4e7eb;">
      <tr>
        <td style="padding:28px 28px 8px 28px;">
          <p style="margin:0 0 4px 0;font-size:18px;font-weight:700;color:#0f9d58;">${BRAND}</p>
          <h1 style="margin:0;font-size:20px;line-height:1.3;color:#1f2933;">Verify your email address</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px 0 28px;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px 0;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 20px 0;">Thanks for creating your ${BRAND} account. Confirm that this email address belongs to you:</p>
          <p style="margin:0 0 20px 0;">
            <a href="${escapeAttribute(url)}" style="display:inline-block;background:#0f9d58;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Verify email address</a>
          </p>
          <p style="margin:0 0 20px 0;font-size:13px;color:#616e7c;">This link can be used once and expires at ${escapeHtml(expiry)}.</p>
          <p style="margin:0 0 20px 0;font-size:13px;color:#616e7c;">If the button does not work, copy this link into your browser:</p>
          <p style="margin:0 0 20px 0;font-size:12px;word-break:break-all;color:#0f9d58;">${escapeAttribute(url)}</p>
          <p style="margin:0 0 8px 0;font-size:13px;color:#616e7c;">If the link does not work, open the ${BRAND} verify-email page and request a new verification email.</p>
          <p style="margin:0 0 24px 0;font-size:13px;color:#616e7c;">If you did not create a ${BRAND} account, you can ignore this email — nothing has changed.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px 28px;border-top:1px solid #e4e7eb;">
          <p style="margin:16px 0 0 0;font-size:12px;color:#9aa5b1;">The WealthHabit team</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

export interface SendVerificationEmailResult {
  delivered: boolean;
  transport: string;
}

/**
 * Sends the verification email. Delivery failures are reported, never thrown:
 * the verification token is already committed and the caller can retry through
 * the resend endpoint, so a provider outage must not turn a successful
 * registration into a 500 or roll back a real account creation.
 *
 * Never includes a password, financial data, or the raw token outside the
 * verification URL.
 */
export async function sendVerificationEmail(
  params: VerificationEmailParams
): Promise<SendVerificationEmailResult> {
  const active = getTransport();
  const content = renderVerificationEmail(params);

  try {
    await active.send({
      to: params.to,
      from: env.EMAIL_FROM,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    return { delivered: true, transport: active.name };
  } catch (error) {
    // Only non-identifying facts: the provider response body can echo the
    // message (and therefore the token), so it is never logged.
    logger.error('email delivery failed', {
      transport: active.name,
      to: params.to,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });

    return { delivered: false, transport: active.name };
  }
}

export const emailService = {
  sendVerificationEmail,
  buildVerificationUrl,
  getCapturedEmails,
  clearCapturedEmails,
  setEmailTransport,
};