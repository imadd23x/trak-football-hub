import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const app='http://127.0.0.1:4189';const backend='https://xbykbqolvqyqmipikuae.supabase.co';const key='sb-xbykbqolvqyqmipikuae-auth-token';
const ids={a:'11111111-1111-4111-8111-111111111111',b:'22222222-2222-4222-8222-222222222222'};
function session(who:'a'|'b',expired=false) {
 const expires_at=Math.floor(Date.now()/1000)+(expired?-120:3600);
 const user={id:ids[who],email:`${who}@family.test`,aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-09-20',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-09-20'};
 const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:expires_at,role:'authenticated',email:user.email}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.synthetic';
 return {user,access_token:token,refresh_token:`refresh-${who}`,token_type:'bearer',expires_at,expires_in:3600};
}
async function fixture(context:BrowserContext,remembered:'expired'|'valid'|'none',block:'refresh'|'password'|'logout') {
 const errors:string[]=[];const unexpected:string[]=[];const aborted:string[]=[];const releases:(()=>void)[]=[];
 let blocked=true;let started=0;
 const track=(page:Page)=>{page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(r.url().startsWith(backend)&&r.failure()?.errorText.includes('ABORTED'))aborted.push(new URL(r.url()).pathname);});};
 context.pages().forEach(track);context.on('page',track);
 await context.addInitScript(({key,value,app})=>{if(location.origin!==app)return;if(!localStorage.getItem('network-fixture-seeded')){if(value)localStorage.setItem(key,JSON.stringify(value));localStorage.setItem('network-fixture-seeded','1');}},{key,app,value:remembered==='none'?null:session('a',remembered==='expired')});
 await context.route('**/*',async route=>{
  const req=route.request();const url=new URL(req.url());
  if(url.origin===app)return route.continue();
  if(url.origin!==backend){if(!url.hostname.startsWith('fonts.'))unexpected.push(url.origin);return route.abort();}
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  const hold=async()=>{started++;await new Promise<void>(resolve=>releases.push(resolve));};
  if(url.pathname==='/auth/v1/token'){
   const body=req.postDataJSON() as {email?:string;refresh_token?:string};const who=body.email==='b@family.test'||body.refresh_token==='refresh-b'?'b':'a';
   const action=url.searchParams.get('grant_type')==='refresh_token'?'refresh':'password';
   if(blocked&&block===action&&who==='a')await hold();return json(session(who));
  }
  if(url.pathname==='/auth/v1/logout'){if(blocked&&block==='logout')await hold();return route.fulfill({status:204});}
  const token=req.headers().authorization?.slice(7);let who:'a'|'b'='a';
  if(token){const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());if(payload.sub===ids.b)who='b';}
  if(url.pathname==='/auth/v1/user'&&req.method()==='GET')return json(session(who).user);
  if(url.pathname==='/rest/v1/profiles'){
   expect(url.searchParams.get('user_id')).toBe(`eq.${ids[who]}`);
   const profile={id:ids[who],user_id:ids[who],role:'parent',full_name:who==='a'?'Alex Parent':'Other Parent',avatar_url:null,nationality:null};
   return json(req.headers().accept?.includes('vnd.pgrst.object')?profile:[profile]);
  }
  if(url.pathname==='/rest/v1/player_parent_links'){expect(url.searchParams.get('parent_user_id')).toBe(`eq.${ids[who]}`);return json([]);}
  if(['/rest/v1/rpc/get_children_awaiting_consent','/rest/v1/rpc/get_my_pending_parent_invites'].includes(url.pathname))return json([]);
  if(url.pathname==='/rest/v1/telemetry_events'&&req.method()==='POST')return json(null,201);
  unexpected.push(`${req.method()} ${url.pathname}`);return json({message:'Unexpected synthetic request'},500);
 });
 return {errors,unexpected,aborted,started:()=>started,unblock:()=>{blocked=false;},release:()=>releases.splice(0).forEach(fn=>fn())};
}
async function signIn(page:Page,who='a') {await page.getByLabel('Email',{exact:true}).fill(`${who}@family.test`);await page.getByLabel('Password',{exact:true}).fill('SyntheticPass1!');await page.getByRole('button',{name:'Sign in',exact:true}).click();}
async function storedUser(page:Page) {return page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null')?.user?.id??null,key);}
for(const path of ['/','/settings'])test(`expired SDK restoration has a real transport deadline and page retry at ${path}`,async({page,context},info)=>{
 await page.setViewportSize({width:path==='/'?320:390,height:844});const state=await fixture(context,'expired','refresh');await page.goto(path);await expect.poll(state.started).toBeGreaterThan(0);
 await expect(page.getByRole('alert')).toContainText('could not restore',{timeout:26_000});await expect.poll(()=>state.aborted.includes('/auth/v1/token')).toBe(true);
 expect(await storedUser(page)).toBe(ids.a);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:info.outputPath(path==='/'?'sdk-restore-320.png':'sdk-restore-settings-390.png'),fullPage:true});
 state.unblock();await page.getByRole('button',{name:'Try again',exact:true}).focus();await page.keyboard.press('Enter');
 if(path==='/')await expect(page.getByRole('button',{name:'Continue as Alex Parent'})).toBeVisible();else await expect(page.getByRole('button',{name:'Alex Parent',exact:true})).toBeVisible();
 state.release();expect(await storedUser(page)).toBe(ids.a);expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('a timed-out sign-in recovers without an automatic late login',async({page,context})=>{
 const state=await fixture(context,'none','password');await page.goto('/');await signIn(page);
 await expect(page.getByRole('alert')).toContainText('took too long',{timeout:26_000});expect(await storedUser(page)).toBeNull();
 await expect.poll(()=>state.aborted.includes('/auth/v1/token')).toBe(true);state.unblock();state.release();
 await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(`${app}/parent/home`);expect(await storedUser(page)).toBe(ids.a);expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('a timed-out sign-out stays signed in and supports an explicit retry',async({page,context})=>{
 const state=await fixture(context,'valid','logout');await page.goto('/');await page.getByRole('button',{name:'Sign in with another account'}).click();
 await expect(page.getByRole('alert')).toContainText('Could not sign out',{timeout:26_000});expect(await storedUser(page)).toBe(ids.a);
 await expect.poll(()=>state.aborted.includes('/auth/v1/logout')).toBe(true);state.unblock();state.release();await page.getByRole('button',{name:'Sign in with another account'}).click();
 await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();expect(await storedUser(page)).toBeNull();expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('an actual second tab signing in B cancels the first tab pending password A',async({page,context})=>{
 const state=await fixture(context,'none','password');await page.goto('/');await signIn(page);await expect.poll(state.started).toBe(1);
 const other=await context.newPage();await other.goto('/');await signIn(other,'b');await expect(other).toHaveURL(`${app}/parent/home`);
 await expect(page.getByRole('button',{name:'Continue as Other Parent'})).toBeVisible();await expect.poll(()=>state.aborted.includes('/auth/v1/token')).toBe(true);
 state.release();expect(await storedUser(page)).toBe(ids.b);await expect(page.getByRole('button',{name:'Continue as Other Parent'})).toBeVisible();
 expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
test('an actual second tab account switch cannot be erased by a pending old sign-out',async({page,context})=>{
 const state=await fixture(context,'valid','logout');await page.goto('/');await expect(page.getByRole('button',{name:'Continue as Alex Parent'})).toBeVisible();
 const other=await context.newPage();await other.goto('/');await expect(other.getByRole('button',{name:'Continue as Alex Parent'})).toBeVisible();
 await page.getByRole('button',{name:'Sign in with another account'}).click();await expect.poll(state.started).toBe(1);
 state.unblock();await other.getByRole('button',{name:'Sign in with another account'}).click();
 // The installed SDK waits five seconds before recovering a held cross-tab lock.
 await expect(other.getByLabel('Email',{exact:true})).toBeVisible({timeout:10_000});
 await signIn(other,'b');await expect(other).toHaveURL(`${app}/parent/home`);
 await expect(page.getByRole('button',{name:'Continue as Other Parent'})).toBeVisible();await expect.poll(()=>state.aborted.includes('/auth/v1/logout')).toBe(true);
 state.release();expect(await storedUser(page)).toBe(ids.b);await expect(page.getByRole('button',{name:'Continue as Other Parent'})).toBeVisible();
 expect(state.errors).toEqual([]);expect(state.unexpected).toEqual([]);
});
