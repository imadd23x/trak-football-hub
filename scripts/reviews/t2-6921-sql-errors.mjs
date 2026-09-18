#!/usr/bin/env node
// Demonstrate the current denial helper's false green without editing its file.
import { PGlite } from '@electric-sql/pglite';
import { candidate, candidateMigrations, readCandidate } from './t2-6921-source.mjs';

const db = new PGlite();
try {
  await db.exec(readCandidate('supabase/tests/bootstrap.sql'));
  const migrations = candidateMigrations();
  for (const file of migrations) await db.exec(file.sql);
  const { rows: version } = await db.query('SELECT version() AS engine');
  const original = readCandidate('supabase/tests/feedback_publication.sql');
  const marker = 'INSERT INTO public.player_feedback (squad_player_id, published_text, author_user_id)';
  if (original.split(marker).length !== 2) throw new Error('SQL negative-control target is not unique');
  const statement = `${marker} VALUES (%L, %L, %L)`;
  if (original.split(statement).length !== 2) throw new Error('SQL statement negative-control target is not unique');
  const variants = [
    ['unmodified', original, null],
    ['undefined-column negative control', original.replace(marker,
      'INSERT INTO public.player_feedback (squad_player_id, definitely_missing_review_column, author_user_id)'), '42703'],
    ['unrelated application exception negative control', original.replace(statement,
      "DO $probe$ BEGIN RAISE EXCEPTION USING ERRCODE = ''P0001'', MESSAGE = ''unrelated probe failure''; END $probe$"), 'P0001'],
  ];
  for (const [label, sql, expectedError] of variants) {
    const reportMarker = '-- ── Report';
    if (sql.split(reportMarker).length !== 2 || !/ROLLBACK;\s*$/.test(sql)) throw new Error('SQL report/rollback boundary changed');
    const reportAt = sql.indexOf(reportMarker);
    let observations, terminalError;
    try {
      // Observe the actual assertion rows before the suite's unchanged terminal
      // reporter can throw. No application function or denial helper is edited.
      await db.exec(sql.slice(0, reportAt));
      ({ rows: observations } = await db.query('SELECT * FROM pg_temp.feedback_results'));
      try { await db.exec(sql.slice(reportAt)); }
      catch (error) { terminalError = { code: error.code, message: error.message }; }
    } finally { await db.exec('ROLLBACK'); }
    if (!Array.isArray(observations) || observations.length !== 16) throw new Error('Expected complete sixteen-assertion result');
    const directInsert = observations.find(row => row.description === 'F-1 a coach cannot INSERT a publication directly');
    const failed = observations.filter(row => !row.passed);
    const passed = expectedError === null ? failed.length === 0 && !terminalError
      : failed.length === 1 && failed[0] === directInsert && directInsert.detail?.includes(expectedError)
        && terminalError?.code === 'P0001' && /1 of 16 desired assertions failed/.test(terminalError.message);
    console.log(JSON.stringify({ candidate, engine: version[0].engine, label, migrations: migrations.length,
      assertions: observations.length, passed, failed, directInsert, terminalError }, null, 2));
    if (!passed) {
      console.error(`FAIL: ${label} did not meet its required discrimination outcome.`);
      process.exitCode = 1;
    }
  }
} finally { await db.close(); }
