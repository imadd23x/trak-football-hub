import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { handleCreateChildLogin, isWeakPassword, WeakPasswordError, type LoginReservation } from './handler.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,options);
serve(req=>handleCreateChildLogin(req,{
  async reserve(jwt,childId,username) {
    const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{
      ...options,global:{headers:{Authorization:`Bearer ${jwt}`}},
    });
    const {data,error}=await caller.rpc('reserve_child_login',{p_roster_child_id:childId,p_username:username});
    if(error || !Array.isArray(data) || data.length!==1) throw new Error('Reservation refused');
    return data[0] as LoginReservation;
  },
  async createConfirmed(identity) {
    const {error}=await admin.auth.admin.createUser(identity);
    if(error) throw isWeakPassword(error) ? new WeakPasswordError() : new Error('Auth creation failed');
  },
}));
