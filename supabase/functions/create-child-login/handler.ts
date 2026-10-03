export interface LoginReservation { reservation_id:string; username:string; ready:boolean; guardian_user_id:string }
export interface ConfirmedChildIdentity {
  email:string; password:string; email_confirm:true;
  app_metadata:{ trak_child_login:true; child_login_reservation:string; child_login_guardian:string };
}
export interface ChildLoginDependencies {
  /** Uses only the caller's captured JWT, so SQL authenticates the guardian. */
  reserve(jwt:string,childId:string,username:string):Promise<LoginReservation>;
  /** Admin createUser only; no invite, OTP or email API. SQL binds atomically. */
  createConfirmed(identity:ConfirmedChildIdentity):Promise<void>;
}
/** TRAK-106: Auth refused the password as too weak or too common (422 weak_password). */
export class WeakPasswordError extends Error { constructor(){ super('weak_password') } }
/** The SDK's AuthWeakPasswordError (auth-js 2.64+, code weak_password); nothing else. */
export function isWeakPassword(error:unknown):boolean {
 const e=error as {name?:unknown;code?:unknown}|null
 return !!e && (e.name==='AuthWeakPasswordError' || e.code==='weak_password')
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
function validReservation(r:LoginReservation,username:string):boolean {
 return !!r && uuid.test(r.reservation_id) && uuid.test(r.guardian_user_id) && r.username===username && typeof r.ready==='boolean';
}
export async function handleCreateChildLogin(req:Request,deps:ChildLoginDependencies):Promise<Response> {
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST') return reply(405,{error:'Use POST'});
 const jwt=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
 if(!jwt) return reply(401,{error:'Sign in with your guardian account'});
 let value:unknown;
 try { value=await req.json(); } catch { return reply(400,{error:'Invalid login request'}); }
 const b=(value && typeof value==='object' && !Array.isArray(value) ? value : {}) as Record<string,unknown>;
 if(Object.keys(b).length!==3 || typeof b.roster_child_id!=='string' || !uuid.test(b.roster_child_id)
   || typeof b.username!=='string' || !/^[a-z0-9._-]{4,30}$/.test(b.username) || !/[0-9]/.test(b.username)
   || typeof b.password!=='string' || b.password.length<8 || b.password.length>128) {
   return reply(400,{error:'Check the username and password'});
 }
 let r:LoginReservation;
 try {
   r=await deps.reserve(jwt,b.roster_child_id,b.username);
   if(!validReservation(r,b.username)) throw new Error('Invalid reservation');
 } catch { return reply(403,{error:'Could not reserve this login. Check the username and your guardian approval.'}); }
 if(r.ready) return reply(200,{username:r.username,state:'already_created'});
 try {
   await deps.createConfirmed({email:`${r.username}@child.trakfootball.com`,password:b.password,email_confirm:true,
     app_metadata:{trak_child_login:true,child_login_reservation:r.reservation_id,child_login_guardian:r.guardian_user_id}});
   return reply(200,{username:r.username,state:'created'});
 } catch(e) {
   // Nothing was created, so there is nothing to recover: ask for another password.
   if(e instanceof WeakPasswordError) return reply(422,{reason:'weak_password',error:'That password is too easy to guess. Choose a different one.'})
   // A provider/network failure can follow a committed creation. Re-read the
   // same reservation under the same JWT; never adopt an arbitrary email match.
   try {
     const recovered=await deps.reserve(jwt,b.roster_child_id,b.username);
     if(validReservation(recovered,b.username) && recovered.reservation_id===r.reservation_id && recovered.ready) {
       return reply(200,{username:r.username,state:'already_created'});
     }
   } catch { /* Refusal is sanitized below; no Auth/SQL details escape. */ }
   return reply(503,{error:'Could not create the login. Check its status and try again.'});
 }
}
