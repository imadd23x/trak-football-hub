import './parent-assessment-history'
import { test, expect, type Locator } from '@playwright/test';

// Real browser, app router/AuthProvider and Supabase SDK. Every backend request
// is intercepted with synthetic data; unknown external calls fail the test.
test('multiple children, truthful match data, failed queries', async ({ page, context }, testInfo) => {
const parent='11111111-1111-4111-8111-111111111111', alex='22222222-2222-4222-8222-222222222222', zara='33333333-3333-4333-8333-333333333333', coach='44444444-4444-4444-8444-444444444444';
const profile={id:parent,user_id:parent,role:'parent',full_name:'Synthetic Parent',nationality:null};
const user={id:parent,email:'parent@example.test',email_confirmed_at:'2026-09-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated',role:'authenticated',created_at:'2026-09-01T00:00:00Z'};
const exp=Math.floor(Date.now()/1000)+3600;
const token=[{alg:'HS256',typ:'JWT'},{sub:parent,exp,role:'authenticated',email:user.email}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.synthetic';
const session={access_token:token,refresh_token:'synthetic-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};
await context.addInitScript((s: object)=>localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token',JSON.stringify(s)),session);
let failMatches=false;
const failLinks=false, logoutFails=true;
const unexpected: string[] = [], errors: string[] = [], writes: { path: string; method: string }[] = [];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{
 const req=route.request(), u=new URL(req.url());
 if(u.origin==='http://127.0.0.1:4189') return route.continue();
 const json=(data: unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(u.hostname!=='xbykbqolvqyqmipikuae.supabase.co') { if(!u.hostname.includes('fonts.')) unexpected.push(req.url()); return route.abort(); }
 if(req.method()!=='GET') writes.push({path:u.pathname,method:req.method()});
 if(u.pathname==='/auth/v1/user') return json(user);
 if(u.pathname==='/auth/v1/logout') return logoutFails?json({msg:'Synthetic logout failure'},500):route.fulfill({status:204});
 if(u.pathname==='/rest/v1/telemetry_events') return json(null,201);
 if(u.pathname==='/rest/v1/rpc/get_children_awaiting_consent') return json([]);
 if(u.pathname==='/rest/v1/rpc/get_roster_children_awaiting_consent') return json([]);
 if(u.pathname==='/rest/v1/rpc/get_my_child_logins') return json([]);
 if(u.pathname==='/rest/v1/rpc/get_my_approved_children_awaiting_signup') return json([]);
 if(u.pathname==='/rest/v1/rpc/guardian_consent_applies') return json(true); // TRAK-177: under the consent age
 if(u.pathname==='/rest/v1/rpc/get_my_child_credentials') return json([]);
 // TRAK-77: Matches also lists the selected child's training (a read, over POST).
 if(u.pathname==='/rest/v1/rpc/family_training_history') return json([]);
 // TRAK-131 (J8.8): Home and Matches read the selected child's events (a read, over POST).
 if (u.pathname === '/rest/v1/rpc/child_events') return json([]);
 if(u.pathname==='/rest/v1/player_parent_links') return failLinks?json({message:'Synthetic network error'},503):json([{player_user_id:alex},{player_user_id:zara}]);
 if(u.pathname==='/rest/v1/profiles') {
   const filter=u.searchParams.get('user_id')||'';
   const rows=filter===`eq.${parent}`?[profile]:filter.includes(coach)?[{user_id:coach,full_name:'Synthetic Coach'}]:[{user_id:alex,full_name:'Alex Example'},{user_id:zara,full_name:'Zara Example'}];
   return json(req.headers().accept?.includes('vnd.pgrst.object')?rows[0]:rows);
 }
 if(u.pathname==='/rest/v1/parental_consents' && req.method()==='GET') {
   expect(u.searchParams.get('parent_user_id')).toBe(`eq.${parent}`);
   expect([`eq.${alex}`,`eq.${zara}`]).toContain(u.searchParams.get('player_user_id'));
   expect(u.searchParams.get('withdrawn_at')).toBe('is.null');
   return json([]);
 }
 if(u.pathname==='/rest/v1/player_details') return json([{position:'Midfielder',current_club:u.searchParams.get('user_id')===`eq.${zara}`?'Zara Academy':'Alex Academy',age_group:'U15'}]);
 if(u.pathname==='/rest/v1/squad_players') return json([{id:u.searchParams.get('linked_player_id')?.slice(3)}]);
 if(u.pathname==='/rest/v1/coach_assessments') return json([{id:'assessment',created_at:'2026-09-01T12:00:00Z',coach_user_id:coach,coach_rating:0,work_rate:0,tactical:0,attitude:0,technical:0,physical:0,coachability:0}]);
 if(u.pathname==='/rest/v1/recognition_awards') return json([]);
 if(u.pathname==='/rest/v1/game_for_family'||u.pathname==='/rest/v1/game_review_for_family') return json([]); // TRAK-286, TRAK-289: no shared plan, no review
 if(u.pathname==='/rest/v1/matches') {
   if(failMatches) return json({message:'Synthetic network error'},503);
   return json([{id:'match-'+u.searchParams.get('user_id'),match_date:'2026-09-01',created_at:'2026-09-18T12:00:00Z',opponent:u.searchParams.get('user_id')===`eq.${zara}`?'Zara Opposition':'Alex Opposition',team_score:0,opponent_score:0,computed_rating:0,competition:'Synthetic League',venue:'Test Pitch'}]);
 }
 unexpected.push(req.method()+' '+u.pathname); return json({message:'Unmocked request blocked'},500);
});
 await page.goto('http://127.0.0.1:4189/parent/home');
 // TRAK-163: Home's header names the followed child; with siblings it is a menu.
 const following=page.getByRole('group',{name:'Following'});
 await expect(following.getByRole('button',{name:'Alex Example'})).toBeVisible();
 // TRAK-194: Home lists no matches; each child's line says whose Home it is.
 await expect(page.getByText('Midfielder · Alex Academy · U15',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('home-mobile.png'),fullPage:true});
 await following.getByRole('button').click();
 await page.getByRole('menuitem',{name:'Zara Example'}).click();
 await expect(following.getByRole('button',{name:'Zara Example'})).toBeVisible();
 await expect(page.getByText('Midfielder · Zara Academy · U15',{exact:true})).toBeVisible();
 await expect(page.getByText('Midfielder · Alex Academy · U15',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Events',exact:true}).click();
 await expect(page.getByRole('combobox')).toHaveValue(zara);
 // TRAK-181: Trak draws the picker and its chevron, so Safari can't swap in its own grey bar.
 await expect(page.getByRole('combobox')).toHaveCSS('appearance','none');
 await expect(page.getByTestId('family-select-chevron')).toBeVisible();
 await expect(page.getByText('D 0–0',{exact:true})).toBeVisible();
 await expect(page.getByText('Difficult',{exact:true})).toBeVisible();
 await expect(page.getByText('1 Sept · Synthetic League · Test Pitch',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('matches-mobile.png'),fullPage:true});
 failMatches=true;
 await page.reload();
 await expect(page.getByText("Couldn't load matches.",{exact:true})).toBeVisible({timeout:10000});
 await expect(page.getByText('No matches yet.',{exact:true})).toHaveCount(0);
 failMatches=false;
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByText('Alex Opposition',{exact:true})).toBeVisible();
 await page.getByRole('combobox').selectOption(zara);
 // TRAK-74: alerts are a bell on Home and show only the selected child's activity.
 await page.getByRole('button',{name:'Home',exact:true}).click();
 await page.getByRole('button',{name:/^Alerts/}).click();
 const alertsSheet=page.getByRole('dialog',{name:'Alerts'});
 await expect(alertsSheet.getByText(/vs Zara Opposition/).first()).toBeVisible();
 await expect(alertsSheet.getByText(/vs Alex Opposition/)).toHaveCount(0);
 // TRAK-122: Escape during the sheet's opening animation can be ignored; wait for it first.
 await alertsSheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
 await page.keyboard.press('Escape');
 await expect(alertsSheet).toHaveCount(0);
 await expect(following.getByRole('button',{name:'Zara Example'})).toBeVisible();
 await expect(page.getByText('Midfielder · Zara Academy · U15',{exact:true})).toBeVisible();
 await expect(page.getByText('Midfielder · Alex Academy · U15',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByText('Parent account · 2 children linked',{exact:true})).toBeVisible();
 // TRAK-181: no "Following" picker on Profile; each child has a consent line.
 await expect(page.getByRole('combobox',{name:'Following'})).toHaveCount(0);
 await expect(page.getByRole('list',{name:'Linked children'})).toContainText('Alex Example');
 await expect(page.getByRole('list',{name:'Linked children'})).toContainText('Zara Example');
 await page.screenshot({path:testInfo.outputPath('connections-mobile.png'),fullPage:true});
 expect(errors).toEqual([]);
 expect(unexpected).toEqual([]);
 expect(writes.every(write => ['/rest/v1/telemetry_events', '/rest/v1/rpc/get_children_awaiting_consent', '/rest/v1/rpc/get_roster_children_awaiting_consent', '/rest/v1/rpc/get_my_child_logins', '/rest/v1/rpc/get_my_child_credentials', '/rest/v1/rpc/get_my_approved_children_awaiting_signup', '/rest/v1/rpc/family_training_history', '/rest/v1/rpc/child_events', '/rest/v1/rpc/guardian_consent_applies', '/auth/v1/logout'].includes(write.path))).toBe(true);
});

// TRAK-182: Arc's sheet springs in from JavaScript, so getAnimations() doesn't
// see it. Wait until it stops moving before a screenshot.
async function sheetAtRest(sheet: Locator) {
  await expect.poll(async () => {
    const before = (await sheet.boundingBox())?.y
    await new Promise(resolve => setTimeout(resolve, 150))
    return before !== undefined && before === (await sheet.boundingBox())?.y
  }).toBe(true)
}

// TRAK-171: exercise the production build with synthetic, intercepted family
// and coach replies. This verifies UI behavior, not deployed phone acceptance.
test.describe('TRAK-171 Home follow-ups', () => {
  test.use({ timezoneId: 'Asia/Dubai' })
  for (const role of ['parent', 'player', 'coach'] as const) {
    test(`${role} Home calendar and records`, async ({ page, context }, testInfo) => {
      const ids = { parent: '97171000-0000-4000-8000-000000000001', player: '97171000-0000-4000-8000-000000000002',
        coach: '97171000-0000-4000-8000-000000000003', sibling: '97171000-0000-4000-8000-000000000004' }
      const id = ids[role]
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
      const user = { id, email: `${role}@home171.test`, email_confirmed_at: '2026-10-01T00:00:00Z',
        created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
      const exp = Math.floor(Date.now() / 1000) + 3600
      const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
        .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
      await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
        { access_token: token, refresh_token: 'synthetic-home171-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
      const event = (child: string) => ({ id: `event-${child}`, title: child === ids.sibling ? 'Sibling training' : 'Technical training',
        event_type: 'training', event_date: day, start_time: '18:00:00', starts_at: `${day}T14:00:00Z`,
        status: 'scheduled', published: true, venue: 'Synthetic pitch', sequence: 0, coach_user_id: ids.coach })
      const assessment = { id: 'training-assessment', squad_player_id: 'squad-171', coach_user_id: ids.coach,
        created_at: `${day}T08:00:00Z`, coach_rating: 8, work_rate: 8, tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8 }
      const unexpected: string[] = [], errors: string[] = [], writes: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url())
        if (url.origin === 'http://127.0.0.1:4189') return route.continue()
        if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
        const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
        if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
        if (req.method() !== 'GET') writes.push(url.pathname)
        if (url.pathname === '/auth/v1/user') return json(user)
        if (url.pathname === '/rest/v1/profiles') {
          const filter = url.searchParams.get('user_id') ?? ''
          const people = [ { user_id: id, id, role, full_name: `Synthetic ${role}` },
            { user_id: ids.player, id: ids.player, role: 'player', full_name: 'Alex Example' },
            { user_id: ids.sibling, id: ids.sibling, role: 'player', full_name: 'Zara Example' } ]
          return json(people.filter(person => filter.includes(person.user_id)).filter((person, i, all) => all.findIndex(p => p.user_id === person.user_id) === i))
        }
        if (url.pathname === '/rest/v1/player_parent_links') return json([{ player_user_id: ids.player }, { player_user_id: ids.sibling }])
        if (url.pathname === '/rest/v1/squad_players') return json(role === 'coach' ? [] : [{ id: 'squad-171', coach_user_id: ids.coach }])
        if (url.pathname === '/rest/v1/coach_assessments') return json(role === 'player' ? [assessment] : [])
        if (url.pathname === '/rest/v1/coach_shared_feedback') return json([{ body: 'Keep pressing after losing the ball.', published_at: `${day}T09:00:00Z` }])
        if (url.pathname === '/rest/v1/coach_calendar_events') return json([event(ids.player)])
        // The event sheet asks for this event's own session (none); Schedule and Home read them all.
        if (url.pathname === '/rest/v1/coach_sessions' && url.searchParams.has('event_id')) return json([])
        if (url.pathname === '/rest/v1/coach_sessions') return json([{ id: 'saved-session', title: 'Logged set pieces', session_type: 'training', session_date: day, event_id: null, venue: 'Synthetic pitch' }])
        if (url.pathname === '/rest/v1/rpc/child_events') {
          const child = req.postDataJSON().p_child
          const filter = url.searchParams.get('id')
          return json(filter && filter !== `eq.event-${child}` ? [] : [event(child)])
        }
        if (url.pathname === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
        // TRAK-261: the coach's notification switches (the bell's "Can't make it"); no row means on.
        if (url.pathname === '/rest/v1/notification_settings') return json([])
        if (url.pathname === '/rest/v1/rpc/my_session_is_live' || url.pathname === '/rest/v1/rpc/feature_on') return json(true)
        if (['get_children_awaiting_consent', 'get_roster_children_awaiting_consent', 'get_my_child_logins', 'get_my_approved_children_awaiting_signup', 'get_player_invites_for_current_user', 'family_training_history', 'my_calendar_link'].some(name => url.pathname === `/rest/v1/rpc/${name}`)) return json([])
        if (url.pathname === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
        // TRAK-262: notification_settings is coach Home's Needs you switch (no row: on).
        if (['matches', 'player_details', 'coach_details', 'recognition_awards', 'session_attendance', 'event_absences', 'notification_settings',
          // TRAK-286: no game plan, shared or not.
          'game_plans', 'game_shares', 'game_evaluations', 'game_evaluation_players', 'game_evaluation_notes', 'game_for_family', 'game_for_player', 'game_review_for_family', 'game_review_for_player', 'training_plans', 'training_plan_practices'].some(name => url.pathname === `/rest/v1/${name}`)) return json([])
        unexpected.push(`${req.method()} ${url.pathname}`)
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
      })
      // The training starts at 18:00 Dubai today; after that the coach's sheet offers
      // Take register, not Published. Hold the page's clock before the start (never ahead of now).
      await page.clock.setFixedTime(new Date(Math.min(Date.now(), Date.parse(`${day}T13:00:00Z`))))
      await page.goto(`/${role}/home`)
      const week = page.getByRole('region', { name: 'This week' })
      await expect(week).toBeVisible()
      if (role === 'player') await expect(page.getByText('Keep pressing after losing the ball.', { exact: true })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`${role}-home.png`), fullPage: true })
      await expect(page.getByText('NEXT UP', { exact: true })).toHaveCount(0)
      if (role === 'parent') {
        // TRAK-182: the event opens where it is, with the family's status and Can't make it.
        await week.getByRole('button', { name: /Technical training/ }).click()
        const sheet = page.getByRole('dialog', { name: 'Technical training' })
        await expect(sheet.getByText('Starts', { exact: true })).toBeVisible()
        await expect(sheet.getByRole('link', { name: 'Open in Maps' })).toBeVisible()
        await expect(sheet.getByRole('button', { name: "Can't make it" })).toBeVisible()
        await expect(sheet.getByRole('button', { name: /Publish|Edit/ })).toHaveCount(0)
        await sheetAtRest(sheet)
        await page.screenshot({ path: testInfo.outputPath('parent-event-sheet.png') })
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
        await page.getByRole('link', { name: 'Calendar' }).focus()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: /Technical training/ })).toBeVisible()
        await page.getByLabel('Following').selectOption(ids.sibling)
        await expect(page.getByRole('link', { name: /Sibling training/ })).toBeVisible()
        await expect(page.getByRole('link', { name: /Technical training/ })).toHaveCount(0)
        await page.screenshot({ path: testInfo.outputPath('parent-events.png'), fullPage: true })
        await page.getByRole('link', { name: /Sibling training/ }).click()
        await expect(page.getByRole('heading', { name: 'Sibling training' })).toBeVisible()
        // The page's own Back, first on the page; the tab bar has an Events button too (TRAK-171, live run 3).
        await page.getByRole('button', { name: 'Events', exact: true }).first().click()
        await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible()
      } else if (role === 'player') {
        await expect(page.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/player/calendar')
        await expect(page.getByText('Keep pressing after losing the ball.', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: /Alerts/ }).click()
        const panel = page.getByRole('dialog', { name: 'Alerts' })
        await panel.getByRole('button', { name: /New assessment from / }).click()
        await expect(panel.getByRole('button', { name: 'Open assessment' })).toBeVisible()
        await expect.poll(() => panel.getByRole('button', { name: 'Open assessment' }).evaluate(button => {
          const frame = button.parentElement?.parentElement
          return !!frame && frame.clientHeight >= frame.scrollHeight - 2
        })).toBe(true)
        await panel.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)))
        await page.screenshot({ path: testInfo.outputPath('player-assessment-bell.png'), fullPage: true })
        await panel.getByRole('button', { name: 'Open assessment' }).click()
        await expect(page.getByRole('heading', { name: 'Coach feedback' })).toBeVisible()
        await expect(page.getByText('Keep pressing after losing the ball.', { exact: true })).toBeVisible()
      } else {
        // TRAK-182 (Imad, 16 Oct): a logged session opens its sheet too. Open
        // session goes to its record, and Back comes back to Home, not to the
        // sessions history.
        // TRAK-262: the coach's week picks an event on a tap; Details opens its sheet.
        await week.getByRole('button', { name: /Logged set pieces/ }).click()
        await week.getByRole('button', { name: 'Details' }).click()
        const logged = page.getByRole('dialog', { name: 'Logged set pieces' })
        await expect(logged.getByText('Logged.')).toBeVisible()
        // Imad, 23 Oct (TRAK-278): the sheet shows the log, read only; Edit log opens the saved record.
        await logged.getByRole('link', { name: 'Edit log' }).click()
        await expect(page).toHaveURL(/\/coach\/sessions\/saved-session$/)
        await page.getByRole('button', { name: 'Back' }).click()
        await expect(page).toHaveURL(/\/coach\/home$/)
        await week.getByRole('button', { name: /Technical training/ }).click()
        await week.getByRole('button', { name: 'Details' }).click()
        const sheet = page.getByRole('dialog', { name: 'Technical training' })
        await expect(sheet.getByRole('button', { name: 'Published' })).toBeDisabled()
        // TRAK-168: "Share" opens the phone's share sheet where there is one, else WhatsApp's link.
        const share = sheet.getByRole('link', { name: 'Share' }).or(sheet.getByRole('button', { name: 'Share' }))
        await expect(share).toBeVisible()
        if (await share.evaluate(el => el.tagName === 'A')) await expect(share).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/)
        await expect(sheet.getByRole('button', { name: 'Edit' })).toBeVisible()
        await expect(sheet.getByText('No players in your squad yet.')).toBeVisible()
        await expect(page).toHaveURL(/\/coach\/home$/)
        await sheetAtRest(sheet)
        await page.screenshot({ path: testInfo.outputPath('coach-event-sheet.png') })
        // TRAK-182: Schedule's month is Arc's calendar, with today's two entries counted.
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
        // TRAK-255: the coach's is called Schedule, and a day with a started event that has no
        // register yet also says "needs you" (by the time of day this runs).
        await page.getByRole('link', { name: 'Schedule' }).click()
        await expect(page.getByRole('gridcell', { name: /, 2 events(, needs you)?$/ })).toHaveAttribute('aria-selected', 'true')
        await page.screenshot({ path: testInfo.outputPath('coach-schedule-month.png'), fullPage: true })
      }
      expect(errors).toEqual([])
      expect(unexpected).toEqual([])
      expect(writes.every(path => path === '/rest/v1/telemetry_events' || path.startsWith('/rest/v1/rpc/'))).toBe(true)
    })
  }
})
