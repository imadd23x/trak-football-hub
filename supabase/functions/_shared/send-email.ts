// TRAK-126 (J8.3): Trak's own email sender, for messages Supabase Auth can't
// send ("Monday's training is cancelled", reminders). It goes through Resend's
// sending API, the same provider and trakfootball.com domain as the Auth SMTP
// (Strategy.md), so it shares that domain's SPF, DKIM and reputation.
//
// Plain text only, one recipient per email. No link may change anything,
// because Microsoft's scanner opens links before the person does (TRAK-107):
// the only links allowed are plain trakfootball.com pages, with no query
// string or fragment to carry a token. Results and logs carry no addresses.
export const RESEND_API = 'https://api.resend.com/emails';

export interface PlainEmail { to: string; subject: string; text: string }
export interface EmailSender {
  /** RESEND_API_KEY, a Supabase secret: never in the repo or the browser. */
  apiKey: string;
  /** EMAIL_FROM: "Trak Football <noreply@trakfootball.com>", the Auth emails' sender. */
  from: string;
  fetch: typeof fetch;
}
export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: 'invalid_email' | 'not_configured' | 'delivery_failed'; status?: number };

const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const LINK = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi;
const TRAK_HOSTS = new Set(['trakfootball.com', 'www.trakfootball.com']);

/** True when the address is the from address's domain: trakfootball.com, where SPF and DKIM are set. */
export function fromTrakDomain(from: string): boolean {
  const address = from.match(/<([^<>]+)>\s*$/)?.[1] ?? from.trim();
  return ADDRESS.test(address) && address.toLowerCase().endsWith('@trakfootball.com');
}

/** True when every link in the text is a plain trakfootball.com page: nothing a scanner could use up. */
export function onlySafeLinks(text: string): boolean {
  for (const raw of text.match(LINK) ?? []) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:' || !TRAK_HOSTS.has(url.hostname.toLowerCase())) return false;
    if (url.search || url.hash || url.username || url.password || url.port) return false;
  }
  return true;
}

/** Why a message can't go, or null when it can. */
export function emailProblem(message: PlainEmail): string | null {
  if (typeof message.to !== 'string' || !ADDRESS.test(message.to.trim())) return 'to must be one email address';
  if (typeof message.subject !== 'string' || !message.subject.trim() || /[\r\n]/.test(message.subject)) {
    return 'subject must be one non-empty line';
  }
  if (message.subject.length > 200) return 'subject is too long';
  if (typeof message.text !== 'string' || !message.text.trim()) return 'text must not be empty';
  if (message.text.length > 20_000) return 'text is too long';
  if (!onlySafeLinks(`${message.subject}\n${message.text}`)) return 'only plain https://trakfootball.com links are allowed';
  return null;
}

export async function sendPlainEmail(message: PlainEmail, sender: EmailSender): Promise<SendResult> {
  if (emailProblem(message)) return { sent: false, reason: 'invalid_email' };
  // Secrets pasted into the dashboard can carry stray spaces at either end.
  const apiKey = sender.apiKey.trim();
  const from = sender.from.trim();
  if (!apiKey || !fromTrakDomain(from)) return { sent: false, reason: 'not_configured' };
  try {
    const response = await sender.fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [message.to.trim()], subject: message.subject.trim(), text: message.text }),
    });
    if (!response.ok) return { sent: false, reason: 'delivery_failed', status: response.status };
    const body = await response.json().catch(() => null) as { id?: unknown } | null;
    return { sent: true, id: typeof body?.id === 'string' ? body.id : null };
  } catch {
    return { sent: false, reason: 'delivery_failed' };
  }
}
