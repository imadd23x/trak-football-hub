"""Replay only a disposable Trak database and test the pilot departure contract.

Usage: python3 coach_departure_ownership_repro.py /absolute/checkout [--control]
A nonzero result is a failing requirement, never a successful security verdict.
No repository, hosted database, or application environment is modified.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

COACH = '90000000-0000-0000-0000-000000000001'
ADMIN_A = '90000000-0000-0000-0000-000000000003'
ADMIN_B = '90000000-0000-0000-0000-000000000004'
SESSION = '90000000-0000-0000-0000-000000000030'
EVENT = '90000000-0000-0000-0000-000000000031'


def identity(user_id: str) -> str:
    return "SELECT set_config('request.jwt.claims', " + (
        f"'{{\"sub\":\"{user_id}\",\"role\":\"authenticated\"}}', true);\n"
    )


def check(expression: str, label: str) -> str:
    return f"SELECT pg_temp.departure_check(({expression}), 'OWNERSHIP', '{label}');\n"


def coach_checks(phase: str) -> str:
    sql = '\\o\n' + f"SELECT '[ownership-probe] {phase} ' || jsonb_build_object(\n"
    sql += "'direct_roster', (SELECT count(*) FROM public.squad_players),\n"
    sql += f"'direct_sessions', (SELECT count(*) FROM public.coach_sessions WHERE id = '{SESSION}'),\n"
    sql += f"'direct_events', (SELECT count(*) FROM public.coach_calendar_events WHERE id = '{EVENT}'),\n"
    for key in ['squad_players', 'coach_assessments', 'coach_assessment_notes', 'coach_sessions', 'coach_calendar_events']:
        sql += f"'export_{key}', jsonb_array_length(public.export_my_account()->'{key}'),\n"
    sql = sql.rstrip(',\n') + ")::text;\n\\o /dev/null\n"
    for key in ['squad_players', 'coach_assessments', 'coach_assessment_notes', 'coach_sessions', 'coach_calendar_events']:
        sql += check(f"COALESCE(jsonb_array_length(public.export_my_account()->'{key}'), 0) = 0", f'{phase}: export excludes academy {key}')
    sql += check(f"SELECT count(*) = 0 FROM public.coach_sessions WHERE id = '{SESSION}'", f'{phase}: former session is not readable')
    sql += check(f"SELECT count(*) = 0 FROM public.coach_calendar_events WHERE id = '{EVENT}'", f'{phase}: former event is not readable')
    sql += check("public.export_my_account()->'profile'->>'full_name' = 'Review Coach A'", f'{phase}: personal account export still works')
    return sql


def replace_once(source: str, marker: str, replacement: str) -> str:
    if source.count(marker) != 1:
        raise ValueError(f'Fixture anchor changed; reconcile manually: {marker}')
    return source.replace(marker, replacement, 1)


def instrument(source: str) -> str:
    marker = '-- Positive controls: legitimate current ownership remains usable.'
    fixtures = f"""
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id, work_rate)
VALUES ('90000000-0000-0000-0000-000000000040', '{COACH}',
 '90000000-0000-0000-0000-000000000020', 7);
INSERT INTO public.coach_assessment_notes (assessment_id, coach_user_id, note)
VALUES ('90000000-0000-0000-0000-000000000040', '{COACH}', 'ACADEMY-PRIVATE-NOTE-CANARY');
INSERT INTO public.coach_calendar_events (id, coach_user_id, title, starts_at)
VALUES ('{EVENT}', '{COACH}', 'Academy A training event', now());
"""
    source = replace_once(source, marker, fixtures + marker)
    marker = identity(ADMIN_A) + f"SELECT public.remove_coach_from_org('{COACH}');"
    controls = check("SELECT count(*) = 1 FROM public.coach_assessments WHERE id = '90000000-0000-0000-0000-000000000040'", 'positive: coach reads own assessment before departure')
    controls += check("SELECT count(*) = 1 FROM public.coach_assessment_notes WHERE note = 'ACADEMY-PRIVATE-NOTE-CANARY'", 'positive: coach reads private note before departure')
    controls += check(f"SELECT count(*) = 1 FROM public.coach_calendar_events WHERE id = '{EVENT}'", 'positive: coach reads event before departure')
    controls += identity(ADMIN_A)
    controls += check(f"SELECT count(*) = 1 FROM public.coach_sessions WHERE id = '{SESSION}'", 'positive: Academy A reads session before departure')
    source = replace_once(source, marker, controls + marker)
    marker = '-- F2: departure must cover archived/released records too, not only active.'
    source = replace_once(source, marker, coach_checks('removed') + marker)
    marker = '-- F2 also crosses academy boundaries: current coach org stamps new records.'
    transfer = check(f"SELECT count(*) = 0 FROM public.coach_sessions WHERE id = '{SESSION}'", 'Academy B must not inherit Academy A session')
    transfer += identity(COACH) + coach_checks('transferred') + identity(ADMIN_A)
    transfer += check(f"SELECT count(*) = 1 FROM public.coach_sessions WHERE id = '{SESSION}'", 'Academy A retains access to its session after transfer')
    transfer += check("SELECT count(*) = 2 FROM public.squad_players WHERE id IN ('90000000-0000-0000-0000-000000000020', '90000000-0000-0000-0000-000000000021')", 'positive: Academy A retains its roster')
    source = replace_once(source, marker, transfer + marker)
    return source


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout', type=Path)
    parser.add_argument('--control', action='store_true', help='Run the unchanged existing native suites.')
    args = parser.parse_args()
    root = args.checkout.resolve(strict=True)
    node = shutil.which('node')
    if node is None:
        raise RuntimeError('Node.js is required')
    with tempfile.TemporaryDirectory(prefix='trak-departure-contract-') as directory:
        stage = Path(directory).resolve()
        (stage / 'scripts').mkdir()
        (stage / 'supabase').mkdir()
        for name in ['migrations', 'tests']:
            shutil.copytree(root / 'supabase' / name, stage / 'supabase' / name)
        for name in ['test-native-db.mjs', 'migration-input.mjs']:
            shutil.copy2(root / 'scripts' / name, stage / 'scripts' / name)
        if not args.control:
            suite = stage / 'supabase/tests/coach_departure_review.sql'
            suite.write_text(instrument(suite.read_text()))
        result = subprocess.run([node, str(stage / 'scripts/test-native-db.mjs')], cwd=stage, timeout=240, check=False)
        return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
