// TRAK-11 phase 3: roster invitations through Supabase Auth, as in
// send-parent-invite (a new-account invite, or a magic link for an existing
// account). The service-role client reads the roster only through
// roster_invite_targets(), after the handler has identified the caller.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, handleRosterInviteRequest, json } from './handler.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://trakfootball.com';
    if (!url || !serviceRole || !anonKey) {
      console.error('send-roster-invites: email credentials are not configured');
      return json({ sent: 0, error: 'Email is not configured yet' }, 500);
    }

    const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(url, serviceRole, clientOptions);
    const publicAuth = createClient(url, anonKey, clientOptions);

    const response = await handleRosterInviteRequest(req, {
      siteUrl,
      serviceRoleKey: serviceRole,
      async getCaller(jwt) {
        const { data, error } = await admin.auth.getUser(jwt);
        return { data: data.user, error };
      },
      async getTargets(rosterChildId, guardianId) {
        return await admin.rpc('roster_invite_targets', { p_roster_child_id: rosterChildId, p_guardian_user_id: guardianId });
      },
      async markSent(rosterChildId, target) {
        return await admin.rpc('mark_roster_invite_sent', { p_roster_child_id: rosterChildId, p_kind: target.kind, p_email: target.email });
      },
      async sendInvite(email, redirectTo, data) {
        return await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data });
      },
      async sendMagicLink(email, redirectTo) {
        return await publicAuth.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
      },
      async confirmServiceKey(token) {
        // Only a genuine service key may list users; a forged claim can't.
        const { error } = await createClient(url, token, clientOptions).auth.admin.listUsers({ page: 1, perPage: 1 });
        return !error;
      },
    });
    // Counts only: no addresses or provider messages, which may contain them.
    const outcome = await response.clone().json();
    console.info('send-roster-invites: outcome', { status: response.status, sent: outcome.sent, failed: outcome.failed, reason: outcome.reason });
    return response;
  } catch {
    console.error('send-roster-invites: delivery initialization failed');
    return json({ sent: 0, error: 'Email delivery is unavailable. Please try again later.' }, 500);
  }
});
