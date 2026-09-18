#!/usr/bin/env node
// Demonstrate the current denial helper's false green without editing its file.
import { PGlite } from '@electric-sql/pglite';
import { candidate, candidateMigrations, readCandidate } from './t2-6921-source.mjs';

if (process.argv.length !== 2) throw new Error('Usage: node scripts/reviews/t2-6921-sql-errors.mjs');
const db = new PGlite();
try {
  await db.exec(readCandidate('supabase/tests/bootstrap.sql'));
  const migrations = candidateMigrations();
  for (const file of migrations) await db.exec(file.sql);
  const { rows: version } = await db.query('SELECT version() AS engine');
  const original = readCandidate('supabase/tests/feedback_publication.sql');
  const marker = 'INSERT INTO public.player_feedback (squad_player_id, published_text, author_user_id)';
  if (original.split(marker).length !== 2) throw new Error('SQL negative-control target is not unique');
  const variants = [
    ['unmodified', original],
    ['undefined-column negative control', original.replace(marker,
      'INSERT INTO public.player_feedback (squad_player_id, definitely_missing_review_column, author_user_id)')],
  ];
  for (const [label, sql] of variants) {
    if (!/ROLLBACK;\s*$/.test(sql)) throw new Error('SQL suite no longer ends with rollback');
    const results = await db.exec(sql.replace(/ROLLBACK;\s*$/,
      'SELECT jsonb_agg(to_jsonb(feedback_results)) AS observations FROM pg_temp.feedback_results; ROLLBACK;'));
    const observations = results.flatMap(result => result.rows ?? []).find(row => row.observations)?.observations;
    if (!Array.isArray(observations) || observations.length !== 16) throw new Error('Expected complete sixteen-assertion result');
    const directInsert = observations.find(row => row.description === 'F-1 a coach cannot INSERT a publication directly');
    console.log(JSON.stringify({ candidate, engine: version[0].engine, label, migrations: migrations.length,
      assertions: observations.length, failed: observations.filter(row => !row.passed), directInsert }, null, 2));
    if (label === 'undefined-column negative control') {
      // A green suite despite 42703 is the defect, not a passing audit result.
      if (directInsert?.passed && directInsert.detail === '42703') {
        console.error('FAIL: the denial helper accepted an undefined-column error as authorization protection.');
        process.exitCode = 1;
      } else throw new Error('Historical negative-control outcome changed; inspect rather than inferring a repair');
    }
  }
} finally { await db.close(); }
