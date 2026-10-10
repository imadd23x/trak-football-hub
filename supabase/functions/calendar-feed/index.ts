// TRAK-132 (J8.9): see handler.ts. The phone's calendar app calls this with
// no login; the token in the path is the credential. calendar_feed_for_token
// (service role only) hashes it, checks the link, consent and squad, records
// the fetch, and returns the events in the feed's shape.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleCalendarFeedRequest, lookupFromRpc } from './handler.ts';

// As in send-parent-invite: a malformed key setting reads as "not configured"
// (503) instead of throwing before the handler runs.
const defaultKey = (raw: string | undefined): string | undefined => {
  try { return (JSON.parse(raw ?? '') as Record<string, string>).default || undefined; } catch { return undefined; }
};

serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey = defaultKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  if (!url || !secretKey) {
    console.error('calendar-feed: not configured');
    return new Response('Calendar temporarily unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const response = await handleCalendarFeedRequest(req, {
    async feedFor(token) {
      const { data, error } = await admin.rpc('calendar_feed_for_token', { p_token: token });
      if (error) throw new Error('lookup failed');
      return lookupFromRpc(data);
    },
  });
  // Outcome only: never the token, the path or any event.
  console.info('calendar-feed: outcome', { status: response.status });
  return response;
});
