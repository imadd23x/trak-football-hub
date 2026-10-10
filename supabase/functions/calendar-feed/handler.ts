// TRAK-132 (J8.9): the private calendar feed a phone subscribes to.
//
// Calendar apps cannot sign in, so the link itself is the credential: a
// 256-bit random token in the path. The database stores only its hash and
// decides everything else (revoked, consent, current squad) in one lookup.
//
// Three outcomes, kept apart on purpose:
// - a live link gets its events;
// - a dead link (revoked, consent withdrawn, child left the squad) gets an
//   EMPTY calendar, so the next refresh removes the events from the phone;
// - a database failure gets 503, never an empty calendar: a hiccup must not
//   wipe a family's schedule from their phone.
// A token that never existed gets 404. No response ever contains the token,
// and nothing may be cached between the app and us.
import { buildCalendarFeed, type FeedEvent } from '../_shared/ical-feed.ts';

export type FeedLookup = { found: false } | { found: true; events: FeedEvent[]; childNames: string[] };

export interface CalendarFeedDependencies {
  /** One database call: hash the token, check the link and consent, return the events. */
  feedFor(token: string): Promise<FeedLookup>;
}

const KINDS = new Set(['training', 'match', 'tournament', 'other']);
const isString = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown) => v === null || isString(v);

function isFeedEvent(v: unknown): v is FeedEvent {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return isString(e.id) && KINDS.has(e.kind as string) && isString(e.squadLabel)
    && isString(e.date) && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    && isTextOrNull(e.startTime) && isTextOrNull(e.endTime) && isTextOrNull(e.meetTime)
    && isTextOrNull(e.opponent) && (e.homeAway === null || e.homeAway === 'home' || e.homeAway === 'away')
    && isTextOrNull(e.venue) && isTextOrNull(e.kit)
    && (e.status === 'scheduled' || e.status === 'cancelled')
    && Number.isInteger(e.sequence) && isString(e.updatedAt);
}

/**
 * Read calendar_feed_for_token's answer: null for a token that never existed,
 * otherwise { events, child_names } (both empty for a dead link). Anything
 * else throws, so the request fails with 503 instead of serving an empty
 * calendar that would wipe the phone.
 */
export function lookupFromRpc(data: unknown): FeedLookup {
  if (data === null) return { found: false };
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected feed lookup');
  const { events, child_names } = data as Record<string, unknown>;
  if (!Array.isArray(events) || !events.every(isFeedEvent)) throw new Error('Unexpected feed events');
  if (!Array.isArray(child_names) || !child_names.every(isString)) throw new Error('Unexpected feed names');
  return { found: true, events, childNames: child_names };
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isCalendarToken(value: string): boolean {
  return TOKEN.test(value);
}

/** 32 random bytes as unpadded base64url: 43 characters. */
export function newCalendarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const FEED_HEADERS = {
  'Content-Type': 'text/calendar; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex',
};

function plain(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** The token from ".../calendar-feed/<token>" or ".../calendar-feed/<token>.ics", or null. */
function tokenFrom(url: string): string | null {
  const segments = new URL(url).pathname.split('/');
  const at = segments.lastIndexOf('calendar-feed');
  if (at === -1 || at !== segments.length - 2) return null;
  const token = segments[at + 1].replace(/\.ics$/, '');
  return isCalendarToken(token) ? token : null;
}

export async function handleCalendarFeedRequest(req: Request, deps: CalendarFeedDependencies): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'Method not allowed', { Allow: 'GET, HEAD' });

  const token = tokenFrom(req.url);
  if (!token) return plain(404, 'Not found');

  let lookup: FeedLookup;
  try {
    lookup = await deps.feedFor(token);
  } catch {
    return plain(503, 'Calendar temporarily unavailable', { 'Retry-After': '300' });
  }
  if (!lookup.found) return plain(404, 'Not found');

  const body = buildCalendarFeed(lookup.events, { childNames: lookup.childNames });
  return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers: FEED_HEADERS });
}
