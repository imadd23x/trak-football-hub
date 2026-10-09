// TRAK-132 (J8.9): see handler.ts. The phone's calendar app calls this with
// no login; the token in the path is the credential. calendar_feed_for_token
// (service role only) hashes it, checks the link, consent and squad, records
// the fetch, and returns the events in the feed's shape.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleCalendarFeedRequest, lookupFromRpc } from './handler.ts';

serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const secretRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  const secretKey = secretRaw ? (JSON.parse(secretRaw) as Record<string, string>).default : undefined;
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
