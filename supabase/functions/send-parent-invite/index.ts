// Supabase Auth delivers new-account invites and existing-account magic links.
// Reads and renewal use the caller's JWT; the service role only sends email.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, handleInviteRequest, json } from './handler.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://trakfootball.com';
    if (!url || !serviceRole || !anonKey) {
      console.error('send-parent-invite: email credentials are not configured');
      return json({ sent: false, error: 'Email is not configured yet' }, 500);
    }

    const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
    const callerClient = (jwt: string) => createClient(url, anonKey, {
      ...clientOptions, global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const admin = createClient(url, serviceRole, clientOptions);
    const publicAuth = createClient(url, anonKey, clientOptions);

    const response = await handleInviteRequest(req, {
      siteUrl,
      async getCaller(jwt) {
        const { data, error } = await callerClient(jwt).auth.getUser(jwt);
        return { data: data.user, error };
      },
      async getRole(jwt, userId) {
        const { data, error } = await callerClient(jwt).from('profiles').select('role').eq('user_id', userId).maybeSingle();
        return { data: data?.role ?? null, error };
      },
      async listInvites(jwt) {
        return await callerClient(jwt).rpc('get_player_invites_for_current_user');
      },
      async resendInvite(jwt, inviteId) {
        return await callerClient(jwt).rpc('resend_parent_invite', { p_invite_id: inviteId });
      },
      async sendInvite(email, redirectTo) {
        return await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_as: 'parent' } });
      },
      async sendMagicLink(email, redirectTo) {
        return await publicAuth.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
      },
    });
    // Keep operational outcomes visible without storing parent emails or provider
    // messages that may contain them. The authenticated caller gets error detail.
    const outcome = await response.clone().json();
    console.info('send-parent-invite: outcome', { status: response.status, sent: outcome.sent, reason: outcome.reason, via: outcome.via });
    return response;
  } catch {
    console.error('send-parent-invite: delivery initialization failed');
    return json({ sent: false, error: 'Email delivery is unavailable. Please try again later.' }, 500);
  }
});
