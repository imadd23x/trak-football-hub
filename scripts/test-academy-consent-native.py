"""Native, independent-connection consent races; synthetic local databases only."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def identity(number: int) -> str:
    return f"96000000-0000-0000-0000-{number:012d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path)
    parser.add_argument('--existing-local', action='store_true', help='Use an empty localhost trak_consent_test database (CI service).')
    args = parser.parse_args()
    pg = args.pg_bin or Path(shutil.which('psql') or '/missing/psql').parent
    env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'TMPDIR', 'LANG')}
    scratch = Path(tempfile.mkdtemp(prefix='trak-consent-native-'))
    managed = not args.existing_local
    host = '127.0.0.1'
    if managed:
        with socket.socket() as sock:
            sock.bind((host, 0))
            port = sock.getsockname()[1]
    else:
        if os.environ.get('PGHOST') not in ('localhost', '127.0.0.1', '::1'):
            raise RuntimeError('Native tests require an explicit loopback PGHOST')
        host = os.environ['PGHOST']
        port = int(os.environ.get('PGPORT', '5432'))
        env['PGPASSWORD'] = os.environ.get('PGPASSWORD', '')

    def run(command: list[str], *, sql: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(command, input=sql, text=True, capture_output=True, env=env, cwd=ROOT, timeout=90)
        if check and result.returncode:
            raise RuntimeError(result.stdout[-3000:] + result.stderr[-3000:])
        return result

    connection = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
                  '-h', host, '-p', str(port), '-U', 'postgres', '-d', 'trak_consent_test']

    def sql(statement: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        return run(connection, sql=statement, check=check)

    def as_parent(parent: int) -> str:
        claims = json.dumps({'role': 'authenticated', 'sub': identity(parent)})
        return f"SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{claims}';"

    def grant(child: int, parent: int, request: int, org: int = 101, expected: str | None = None) -> str:
        del parent  # The caller identity comes from the authenticated session, never an RPC argument.
        expect = f"'{expected}'::uuid" if expected else 'NULL'
        notice = 201 if org == 101 else 202
        return (f"SELECT public.record_academy_consent('{identity(child)}','{identity(org)}','{identity(request)}',"
                f"{expect},'{identity(notice)}','parent',"
                "'{\"coaching_records\":true,\"recognition\":false,\"parent_visibility\":true}');")

    def response(output: str) -> dict:
        return json.loads(next(line for line in output.splitlines() if line.startswith('{')))

    def race(first: str, first_parent: int, second: str, second_parent: int, label: str) -> tuple[dict, subprocess.CompletedProcess[str]]:
        """Hold the first transaction until the second is observably lock-blocked."""
        holder = subprocess.Popen(connection, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, env=env, cwd=ROOT)
        assert holder.stdin is not None and holder.stdout is not None
        follower_name = 'consent-race-' + label
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            holder.stdin.write("SET statement_timeout='15s'; BEGIN;\n" + as_parent(first_parent) + '\n' + first + '\n')
            holder.stdin.flush()
            # The SQL statement timeout bounds a failed first call; failures close psql.
            line = holder.stdout.readline()
            if not line.startswith('{'):
                raise RuntimeError('First transaction did not return a decision: ' + line)
            first_result = json.loads(line)
            future = pool.submit(sql, f"SET application_name='{follower_name}'; SET statement_timeout='15s'; BEGIN;"
                                 + as_parent(second_parent) + second + 'COMMIT;', check=False)
            blocked = False
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and not future.done():
                blocked = sql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='"
                              + follower_name + "' AND cardinality(pg_blocking_pids(pid))>0);").stdout.strip() == 't'
                if blocked:
                    break
                time.sleep(0.03)
            if not blocked:
                raise AssertionError('Independent transaction never observed blocked: ' + label)
            holder.stdin.write('COMMIT;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=10)
            second_result = future.result(timeout=20)
            assert holder.returncode == 0
            print('Observed native lock overlap:', label, flush=True)
            return first_result, second_result
        finally:
            if holder.poll() is None:
                holder.terminate()
                holder.wait(timeout=10)
            pool.shutdown(wait=True)

    started = False
    try:
        if managed:
            run([str(pg / 'initdb'), '-D', str(scratch / 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale'])
            run([str(pg / 'pg_ctl'), '-D', str(scratch / 'data'), '-l', str(scratch / 'postgres.log'),
                 '-o', f'-p {port} -h {host} -k {scratch}', '-w', 'start'])
            started = True
            run([str(pg / 'createdb'), '-h', host, '-p', str(port), '-U', 'postgres', 'trak_consent_test'])
        # Refuse to load fixtures into a populated database, even on loopback.
        empty = sql("SELECT current_database()='trak_consent_test' AND to_regnamespace('auth') IS NULL "
                    "AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                    "WHERE n.nspname='public' AND c.relkind IN ('r','v','m'));").stdout.strip()
        assert empty == 't', 'Refusing native fixtures in a non-empty or incorrectly named database'
        print(sql('SELECT version();').stdout.strip(), flush=True)
        sql((ROOT / 'supabase/tests/bootstrap.sql').read_text())
        inventory = run(['node', '--input-type=module', '-e',
                         "import {readdirSync} from 'node:fs'; import {validateMigrationFiles} from './scripts/migration-input.mjs';"
                         "console.log(JSON.stringify(validateMigrationFiles(readdirSync('supabase/migrations'))));"])
        files = json.loads(inventory.stdout)
        for filename in files:
            sql((ROOT / 'supabase/migrations' / filename).read_text())
        for suite in ['parent_invite_security.sql', 'pilot_view_security.sql', 'privilege_and_consent_security.sql', 'academy_consent_authority.sql', 'academy_consent_writes.sql']:
            sql("SET trak.test_database='disposable';\n" + (ROOT / 'supabase/tests' / suite).read_text())
            print('Native suite passed:', suite, flush=True)
        fixture = (ROOT / 'supabase/tests/academy_consent_authority.sql').read_text().split('-- Legacy evidence')[0]
        sql("SET trak.test_database='disposable';\n" + fixture + '\nCOMMIT;')
        # Distinct children keep cases independent without deleting any audit event.
        for child in [21, 22, 23, 24, 31, 32, 33, 34, 35, 36]:
            uid = identity(child)
            sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{uid}','race-{child}@test.invalid',now());"
                f"INSERT INTO public.profiles(user_id,role,full_name) VALUES('{uid}','player','Synthetic race child');"
                f"INSERT INTO public.player_details(user_id,date_of_birth) VALUES('{uid}',current_date-interval '17 years');"
                f"INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES('{uid}','{identity(1)}'),('{uid}','{identity(2)}');"
                f"INSERT INTO public.squad_players(coach_user_id,player_name,linked_player_id) VALUES('{identity(5)}','Synthetic A','{uid}'),('{identity(6)}','Synthetic B','{uid}');")
        first, second = race(grant(21, 1, 701), 1, grant(21, 1, 701), 1, 'same-request')
        assert second.returncode == 0, second.stderr
        assert response(second.stdout)['event_id'] == first['event_id']
        assert response(second.stdout)['replayed'] is True
        assert sql(f"SELECT count(*) FROM trak_consent.events WHERE player_user_id='{identity(21)}';").stdout.strip() == '1'

        first, second = race(grant(22, 1, 702), 1, grant(22, 2, 703), 2, 'two-guardians')
        assert second.returncode == 0, second.stderr
        assert response(second.stdout)['event_id'] != first['event_id']
        assert sql(f"SELECT count(*) FROM trak_consent.decisions WHERE player_user_id='{identity(22)}';").stdout.strip() == '2'
        assert sql(f"SELECT revision FROM trak_consent.scopes WHERE player_user_id='{identity(22)}';").stdout.strip() == '2'

        original = response(sql('BEGIN;' + as_parent(1) + grant(23, 1, 704) + 'COMMIT;').stdout)['event_id']
        withdrawal = f"SELECT public.withdraw_academy_consent('{identity(23)}','{identity(101)}','{identity(705)}','{original}');"
        first, second = race(withdrawal, 1, grant(23, 1, 706, expected=original), 1, 'withdraw-stale-grant')
        assert first['action'] == 'withdraw' and not first['coaching_approved']
        assert second.returncode != 0 and '40001' in second.stderr, second.stderr
        assert sql(f"SELECT e.action FROM trak_consent.decisions d JOIN trak_consent.events e ON e.id=d.event_id WHERE d.player_user_id='{identity(23)}';").stdout.strip() == 'withdraw'

        first, second = race(grant(24, 1, 707), 1, grant(24, 1, 707, org=102), 1, 'request-scope-conflict')
        assert second.returncode != 0 and '22023' in second.stderr, second.stderr
        assert sql(f"SELECT count(*) FROM trak_consent.events WHERE player_user_id='{identity(24)}';").stdout.strip() == '1'
        def assessment(child: int, record: int) -> str:
            return ("WITH saved AS (INSERT INTO public.coach_assessments(id,coach_user_id,squad_player_id) "
                    f"SELECT '{identity(record)}','{identity(5)}',id FROM public.squad_players "
                    f"WHERE linked_player_id='{identity(child)}' AND coach_user_id='{identity(5)}' "
                    "RETURNING id) SELECT json_build_object('record_id',id) FROM saved;")

        def withdraw(child: int, request: int, event: str) -> str:
            return f"SELECT public.withdraw_academy_consent('{identity(child)}','{identity(101)}','{identity(request)}','{event}');"

        def unlink(child: int) -> str:
            # Model a privileged relationship removal without giving app roles a
            # table DELETE grant. The contender remains an actual coach role.
            return ("RESET ROLE; WITH removed AS (DELETE FROM public.player_parent_links "
                    f"WHERE player_user_id='{identity(child)}' AND parent_user_id='{identity(1)}' "
                    "RETURNING player_user_id) SELECT json_build_object('unlinked',player_user_id) FROM removed;")

        def record_count(record: int) -> int:
            return int(sql(f"SELECT count(*) FROM public.coach_assessments WHERE id='{identity(record)}';").stdout.strip())

        first, second = race(grant(31, 1, 801), 1, assessment(31, 831), 5, 'grant-before-write')
        assert second.returncode == 0, second.stderr
        assert record_count(831) == 1
        assert sql(f"SELECT guardian_event_ids=ARRAY['{first['event_id']}'::uuid] FROM trak_consent.authorization_receipts WHERE record_id='{identity(831)}';").stdout.strip() == 't'

        event = response(sql('BEGIN;' + as_parent(1) + grant(32, 1, 802) + 'COMMIT;').stdout)['event_id']
        first, second = race(assessment(32, 832), 5, withdraw(32, 803, event), 1, 'write-before-withdraw')
        assert second.returncode == 0 and response(second.stdout)['action'] == 'withdraw', second.stderr
        assert record_count(832) == 1
        later = sql('BEGIN;' + as_parent(5) + assessment(32, 842) + 'COMMIT;', check=False)
        assert later.returncode != 0 and '42501' in later.stderr, later.stderr
        assert record_count(842) == 0

        event = response(sql('BEGIN;' + as_parent(1) + grant(33, 1, 804) + 'COMMIT;').stdout)['event_id']
        first, second = race(withdraw(33, 805, event), 1, assessment(33, 833), 5, 'withdraw-before-write')
        assert first['action'] == 'withdraw'
        assert second.returncode != 0 and '42501' in second.stderr, second.stderr
        assert record_count(833) == 0
        assert sql(f"SELECT count(*) FROM trak_consent.authorization_receipts WHERE record_id='{identity(833)}';").stdout.strip() == '0'

        sql('BEGIN;' + as_parent(1) + grant(34, 1, 806) + 'COMMIT;')
        first, second = race(unlink(34), 1, assessment(34, 834), 5, 'unlink-before-write')
        assert second.returncode != 0 and '42501' in second.stderr, second.stderr
        assert record_count(834) == 0

        sql('BEGIN;' + as_parent(1) + grant(35, 1, 807) + 'COMMIT;')
        first, second = race(assessment(35, 835), 5, unlink(35), 1, 'write-before-unlink')
        assert second.returncode == 0 and response(second.stdout)['unlinked'] == identity(35), second.stderr
        assert record_count(835) == 1
        later = sql('BEGIN;' + as_parent(5) + assessment(35, 845) + 'COMMIT;', check=False)
        assert later.returncode != 0 and '42501' in later.stderr, later.stderr
        assert record_count(845) == 0

        sql('BEGIN;' + as_parent(1) + grant(36, 1, 808) + 'COMMIT;')
        transfer = (f"RESET ROLE; UPDATE public.coach_details SET organization_id='{identity(102)}' WHERE user_id='{identity(5)}';"
                    "SELECT json_build_object('transferred',true);")
        first, second = race(transfer, 5, assessment(36, 836), 5, 'transfer-before-write')
        assert second.returncode != 0 and '42501' in second.stderr, second.stderr
        assert record_count(836) == 0
        print('PASS: ten independent-connection races, exact event/revision/record/receipt assertions', flush=True)
    finally:
        if started:
            run([str(pg / 'pg_ctl'), '-D', str(scratch / 'data'), '-m', 'fast', '-w', 'stop'])
            print('Disposable native PostgreSQL stopped', flush=True)


if __name__ == '__main__':
    main()
