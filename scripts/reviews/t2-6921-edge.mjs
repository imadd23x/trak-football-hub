#!/usr/bin/env node
// Extends the transport-boundary review in 5e71caf with K8 quota controls.
// Executes pinned candidate handler logic; no hosted/provider calls are made.
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { candidate, readCandidate } from './t2-6921-source.mjs';
const original = readCandidate('supabase/functions/player-feedback/index.ts');
const source = original.replace(/^import \{ serve \} from "https:\/\/deno\.land\/std@0\.168\.0\/http\/server\.ts";\r?\n/m, '')
  .replace(/^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@2\.45\.0";\r?\n/m, '');
if (source.includes('import ')) throw new Error('Imports changed; transport boundary needs review');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const point = { title: 'First touch', what: 'Control the ball.', why: 'Keep possession.', drill: 'Practise receiving.' };
const feedback = { points: [point, point, point], encouragement: 'Keep practising.' };
async function execute(label, options = {}) {
  let handler; const writes = []; const quota = []; let providerCalls = 0;
  const database = {
    auth: { getUser: async () => ({ data: { user: options.noAuth ? null : { id: 'synthetic-coach' } }, error: null }) },
    rpc: async (fn, args) => { quota.push({fn,args}); return { data: options.quotaAllowed ?? true, error: options.quotaError ? { message: 'synthetic quota failure' } : null }; },
    from: table => {
      const query = { select: () => query, eq: () => query, insert: row => { writes.push(row); return query; },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { role: options.role ?? 'coach' }, error: null };
          if (table === 'coach_assessments') return { data: { id: 'assessment-a', squad_player_id: 'adult-a', coach_rating: 7, work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7, appearance: 'match' }, error: null };
          if (table === 'squad_players') return { data: { id: 'adult-a', player_name: 'Synthetic Adult', position: 'midfielder' }, error: null };
          if (table === 'coach_assessment_notes') return { data: null, error: null };
          if (table === 'ai_feedback_drafts') return options.saveFails ? { data: null, error: { message: 'synthetic persistence failure' } } : { data: { id: 'draft-a' }, error: null };
          throw new Error('Unmocked table ' + table);
        } };
      return query;
    },
  };
  runInNewContext(compiled, { serve: cb => { handler = cb; }, createClient: () => database,
    Deno: { env: { get: name => ({ LOVABLE_API_KEY: 'synthetic', SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'synthetic' })[name] } },
    fetch: async () => { providerCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(options.feedback ?? feedback) } }] }), { headers: { 'Content-Type': 'application/json' } }); },
    Request, Response, console: { error: () => {} },
  });
  const response = await handler(new Request('https://test.invalid/player-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' }, body: JSON.stringify(options.body ?? { assessment_id: 'assessment-a' }) }));
  const expectedStatus = options.status ?? 200;
  const passed = response.status === expectedStatus && providerCalls === (options.providerCalls ?? 1) && writes.length === (options.writes ?? 1) && quota.length === (options.quotaCalls ?? 1) && quota.every(q => q.fn === 'claim_ai_call' && q.args.p_function_name === 'player-feedback' && q.args.p_daily_limit === 200);
  return { label, passed, status: response.status, expectedStatus, providerCalls, writes: writes.length, quotaCalls: quota.length };
}
const controls = [
  await execute('valid note-free draft'),
  await execute('401 before quota/provider', { noAuth: true, status: 401, providerCalls: 0, writes: 0, quotaCalls: 0 }),
  await execute('missing assessment before quota/provider', { body: {}, status: 400, providerCalls: 0, writes: 0, quotaCalls: 0 }),
  await execute('quota refusal before provider/persistence', { quotaAllowed: false, status: 429, providerCalls: 0, writes: 0 }),
  await execute('quota error before provider/persistence', { quotaError: true, status: 503, providerCalls: 0, writes: 0 }),
  await execute('player denied before provider/persistence', { role: 'player', status: 403, providerCalls: 0, writes: 0 }),
  await execute('save failure is not saved success', { saveFails: true, status: 500 }),
];
const malformed = [];
for (const [label, bad] of [
  ['null point', { points: [null], encouragement: 'Keep practising.' }],
  ['missing fields', { points: [{}], encouragement: 'Keep practising.' }],
  ['object title', { points: [{ ...point, title: { unexpected: true } }], encouragement: 'Keep practising.' }],
  ['object encouragement', { points: [point,point,point], encouragement: { unexpected: true } }],
]) malformed.push(await execute(label, { feedback: bad, status: 500, writes: 0 }));
console.log(JSON.stringify({ candidate, controls, malformed }, null, 2));
if ([...controls, ...malformed].some(r => !r.passed)) process.exitCode = 1;
