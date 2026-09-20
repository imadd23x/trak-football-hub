import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleStaffInviteRequest } from './handler.ts';
import { corsHeaders, json } from '../send-parent-invite/handler.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ sent: false, reason: 'mail_not_configured' }, 503);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const caller = (jwt: string) => createClient(url, anon, { ...options, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(url, service, options);
  const publicAuth = createClient(url, anon, options);
  return handleStaffInviteRequest(req, {
    siteUrl: Deno.env.get('SITE_URL') ?? 'https://trakfootball.com',
    async getCaller(jwt) {
      const { data, error } = await caller(jwt).auth.getUser(jwt);
      return { data: data.user, error };
    },
    async issue(jwt, input) {
      return await caller(jwt).rpc('prepare_staff_invite_email', {
        p_request_id: input.request_id, p_role: input.role, p_email: input.email,
        p_organization_id: input.organization_id ?? null, p_academy_name: input.academy_name ?? null,
      });
    },
    async status(jwt, invitationId) {
      return await caller(jwt).rpc('staff_invite_delivery_status', { p_invitation_id: invitationId });
    },
    async finish(invitationId, attemptId, outcome) {
      return await admin.rpc('finish_staff_invite_delivery', { p_invitation_id: invitationId, p_attempt_id: attemptId, p_outcome: outcome });
    },
    async sendInvite(email, redirectTo) {
      return await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    },
    async sendMagicLink(email, redirectTo) {
      return await publicAuth.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    },
  });
});
