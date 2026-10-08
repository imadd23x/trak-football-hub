import { describe, expect, it, vi } from 'vitest';
import {
  RESEND_API,
  emailProblem,
  fromTrakDomain,
  onlySafeLinks,
  sendPlainEmail,
  type PlainEmail,
} from '../../supabase/functions/_shared/send-email';
import { handleSendEmailRequest, type SendEmailDependencies } from '../../supabase/functions/send-email/handler';

// TRAK-126 (J8.3): Trak's own sender for event emails, through Resend. These
// tests pin what may be sent (plain text, one recipient, no link a scanner
// could use up: TRAK-107), what goes to Resend, and who may call send-email.

const FROM = 'Trak Football <noreply@trakfootball.com>';
const SECRET_KEY = 'sb_secret_operator-test-key';
const message: PlainEmail = {
  to: 'guardian@example.test',
  subject: 'U15 training cancelled today',
  text: 'Monday 13 Oct 18:00 training is cancelled: pitch closed.\nFull schedule in Trak: https://trakfootball.com',
};

function resend(status = 200, body: unknown = { id: 'email-1' }) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('onlySafeLinks', () => {
  it('allows text with no links and plain trakfootball.com pages', () => {
    expect(onlySafeLinks('Training at 18:00')).toBe(true);
    expect(onlySafeLinks('See https://trakfootball.com or https://www.trakfootball.com/player/home.')).toBe(true);
    expect(onlySafeLinks('www.trakfootball.com')).toBe(true);
  });

  it('refuses anything a link scanner could use up or that leaves Trak', () => {
    expect(onlySafeLinks('https://trakfootball.com/auth/code?type=invite&token=1')).toBe(false);
    expect(onlySafeLinks('https://trakfootball.com/#access_token=x')).toBe(false);
    expect(onlySafeLinks('http://trakfootball.com')).toBe(false);
    expect(onlySafeLinks('https://evil.example/trakfootball.com')).toBe(false);
    expect(onlySafeLinks('https://trakfootball.com.evil.example')).toBe(false);
    expect(onlySafeLinks('https://xbykbqolvqyqmipikuae.supabase.co/auth/v1/verify')).toBe(false);
    expect(onlySafeLinks('www.example.com')).toBe(false);
  });
});

describe('emailProblem', () => {
  it('accepts a plain message', () => {
    expect(emailProblem(message)).toBeNull();
  });

  it('refuses more than one recipient, a multi-line subject, empty text or an unsafe link', () => {
    expect(emailProblem({ ...message, to: 'a@example.test, b@example.test' })).toMatch(/one email address/);
    expect(emailProblem({ ...message, to: 'not-an-address' })).toMatch(/one email address/);
    expect(emailProblem({ ...message, subject: 'Hi\nBcc: x@example.test' })).toMatch(/one non-empty line/);
    expect(emailProblem({ ...message, subject: ' ' })).toMatch(/one non-empty line/);
    expect(emailProblem({ ...message, text: '' })).toMatch(/must not be empty/);
    expect(emailProblem({ ...message, text: 'Confirm: https://trakfootball.com/x?ok=1' })).toMatch(/trakfootball\.com links/);
    expect(emailProblem({ ...message, subject: 'See https://example.com' })).toMatch(/trakfootball\.com links/);
  });
});

describe('fromTrakDomain', () => {
  it('accepts only a trakfootball.com sender, where SPF and DKIM are set', () => {
    expect(fromTrakDomain(FROM)).toBe(true);
    expect(fromTrakDomain('schedule@trakfootball.com')).toBe(true);
    expect(fromTrakDomain('Trak <onboarding@resend.dev>')).toBe(false);
    expect(fromTrakDomain('')).toBe(false);
  });
});

describe('sendPlainEmail', () => {
  it('posts one plain-text email to Resend with the key as a bearer token', async () => {
    const fetch = resend();
    await expect(sendPlainEmail(message, { apiKey: 're_test', from: FROM, fetch })).resolves.toEqual({ sent: true, id: 'email-1' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(RESEND_API);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Authorization: 'Bearer re_test', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ from: FROM, to: [message.to], subject: message.subject, text: message.text });
  });

  it('ignores stray spaces around the key and sender, as pasted into the dashboard', async () => {
    const fetch = resend();
    await expect(sendPlainEmail(message, { apiKey: ' re_test\n', from: ` ${FROM} `, fetch })).resolves.toEqual({ sent: true, id: 'email-1' });
    const [, init] = fetch.mock.calls[0];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer re_test' });
    expect(JSON.parse(String(init?.body)).from).toBe(FROM);
  });

  it('sends nothing for an invalid message or a missing key or sender', async () => {
    const fetch = resend();
    expect(await sendPlainEmail({ ...message, text: 'https://example.com' }, { apiKey: 're_test', from: FROM, fetch }))
      .toEqual({ sent: false, reason: 'invalid_email' });
    expect(await sendPlainEmail(message, { apiKey: '', from: FROM, fetch })).toEqual({ sent: false, reason: 'not_configured' });
    expect(await sendPlainEmail(message, { apiKey: 're_test', from: 'Trak <a@resend.dev>', fetch }))
      .toEqual({ sent: false, reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a refusal or a network failure as delivery_failed', async () => {
    expect(await sendPlainEmail(message, { apiKey: 're_test', from: FROM, fetch: resend(422, { message: 'x' }) }))
      .toEqual({ sent: false, reason: 'delivery_failed', status: 422 });
    const down = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network'));
    expect(await sendPlainEmail(message, { apiKey: 're_test', from: FROM, fetch: down })).toEqual({ sent: false, reason: 'delivery_failed' });
  });
});

describe('handleSendEmailRequest', () => {
  function deps(): SendEmailDependencies & { send: ReturnType<typeof vi.fn<SendEmailDependencies['send']>> } {
    return { secretKeys: [SECRET_KEY], send: vi.fn<SendEmailDependencies['send']>().mockResolvedValue({ sent: true, id: 'email-1' }) };
  }
  const request = (body: unknown, headers: Record<string, string> = { apikey: SECRET_KEY }, method = 'POST') =>
    new Request('https://edge.test/send-email', { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });

  it('sends for the operator and reports the provider id, never the address', async () => {
    const d = deps();
    const response = await handleSendEmailRequest(request(message), d);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ sent: true, id: 'email-1' });
    expect(JSON.stringify(body)).not.toContain(message.to);
    expect(d.send).toHaveBeenCalledWith(message);
  });

  it('refuses anyone without a project secret key, including a user session', async () => {
    const callers: Record<string, string>[] = [{}, { apikey: 'sb_publishable_browser-key' }, { Authorization: 'Bearer user.jwt.here' }];
    for (const headers of callers) {
      const d = deps();
      expect((await handleSendEmailRequest(request(message, headers), d)).status).toBe(401);
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it('accepts exactly { to, subject, text } with a safe message', async () => {
    for (const body of [{ ...message, html: '<b>x</b>' }, { to: message.to, text: message.text }, [message], 'text']) {
      const d = deps();
      expect((await handleSendEmailRequest(request(body), d)).status).toBe(400);
      expect(d.send).not.toHaveBeenCalled();
    }
    const d = deps();
    const unsafe = await handleSendEmailRequest(request({ ...message, text: 'https://trakfootball.com/auth/code?token=1' }), d);
    expect(unsafe.status).toBe(400);
    expect(await unsafe.json()).toMatchObject({ reason: 'invalid_email' });
    expect(d.send).not.toHaveBeenCalled();
  });

  it('only takes POST', async () => {
    expect((await handleSendEmailRequest(request(null, { apikey: SECRET_KEY }, 'GET'), deps())).status).toBe(405);
  });

  it('says when the sender is not configured, and when the provider refuses', async () => {
    const notSet = deps();
    notSet.send.mockResolvedValue({ sent: false, reason: 'not_configured' });
    expect((await handleSendEmailRequest(request(message), notSet)).status).toBe(500);
    const refused = deps();
    refused.send.mockResolvedValue({ sent: false, reason: 'delivery_failed', status: 403 });
    const response = await handleSendEmailRequest(request(message), refused);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ sent: false, reason: 'delivery_failed', status: 403 });
  });
});
