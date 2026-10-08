// TRAK-126 (J8.3): see handler.ts. RESEND_API_KEY and EMAIL_FROM are Supabase
// secrets (Edge Functions → Secrets), set by the account owner.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { sendPlainEmail } from '../_shared/send-email.ts';
import { keyValues } from '../send-roster-invites/handler.ts';
import { handleSendEmailRequest } from './handler.ts';

serve(async (req) => {
  try {
    const sender = { apiKey: Deno.env.get('RESEND_API_KEY') ?? '', from: Deno.env.get('EMAIL_FROM') ?? '', fetch };
    const response = await handleSendEmailRequest(req, {
      secretKeys: keyValues(Deno.env.get('SUPABASE_SECRET_KEYS')),
      send: message => sendPlainEmail(message, sender),
    });
    // Outcome only: no addresses, subjects or provider messages.
    const outcome = await response.clone().json();
    console.info('send-email: outcome', { status: response.status, sent: outcome.sent, reason: outcome.reason });
    return response;
  } catch {
    console.error('send-email: delivery initialization failed');
    return new Response(JSON.stringify({ sent: false, error: 'Email delivery is unavailable' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
