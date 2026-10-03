import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleCreateChildLogin, type LoginReservation } from './handler.ts';

// TRAK-96: the new API keys (JSON keyed by name, "default"), not the legacy
// service_role/anon JWTs, which stop working at the end of 2026.
const defaultKey = (name: string): string => {
  const key = (JSON.parse(Deno.env.get(name) ?? '{}') as Record<string, string>).default;
  if (!key) throw new Error(`${name} has no default key`);
  return key;
};
const url=Deno.env.get('SUPABASE_URL')!;
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,defaultKey('SUPABASE_SECRET_KEYS'),options);
serve(req=>handleCreateChildLogin(req,{
  async reserve(jwt,childId,username) {
    const caller=createClient(url,defaultKey('SUPABASE_PUBLISHABLE_KEYS'),{
      ...options,global:{headers:{Authorization:`Bearer ${jwt}`}},
    });
    const {data,error}=await caller.rpc('reserve_child_login',{p_roster_child_id:childId,p_username:username});
    if(error || !Array.isArray(data) || data.length!==1) throw new Error('Reservation refused');
    return data[0] as LoginReservation;
  },
  async createConfirmed(identity) {
    const {error}=await admin.auth.admin.createUser(identity);
    if(error) throw new Error('Auth creation failed');
  },
}));
