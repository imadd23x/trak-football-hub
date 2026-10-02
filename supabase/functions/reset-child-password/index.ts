import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleResetChildPassword } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
serve(req => handleResetChildPassword(req, {
  async authorize(jwt, rosterChildId) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      ...options, global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data, error } = await caller.rpc('authorize_child_password_reset', { p_roster_child_id: rosterChildId });
    if (error || typeof data !== 'string') throw new Error('Guardian authorization refused');
    return data;
  },
  async reset(authUserId, password) {
    const { error } = await admin.auth.admin.updateUserById(authUserId, { password });
    if (error) throw new Error('Auth password update failed');
  },
  async endSessions(authUserId) {
    const { data, error } = await admin.rpc('end_child_login_sessions', { p_auth_user_id: authUserId });
    if (error || typeof data !== 'number') throw new Error('Could not end the child sessions');
    return data;
  },
}));
