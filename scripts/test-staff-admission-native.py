"""Native, independent-connection staff-admission races; synthetic local databases only."""
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
    return f"98000000-0000-0000-0000-{number:012d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path)
    parser.add_argument('--existing-local', action='store_true', help='Use an empty localhost trak_staff_test database (CI service).')
    parser.add_argument('--falsify-recipient-lock', action='store_true', help='Prove removal of the recipient lock admits both competing invitations; disposable local databases only.')
    args = parser.parse_args()
    pg = args.pg_bin or Path(shutil.which('psql') or '/missing/psql').parent
    env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'TMPDIR', 'LANG')}
    scratch = Path(tempfile.mkdtemp(prefix='trak-staff-native-'))
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
                  '-h', host, '-p', str(port), '-U', 'postgres', '-d', 'trak_staff_test']

    def sql(statement: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        return run(connection, sql=statement, check=check)

    def actor(user: int | None) -> str:
        if user is None:
            return "SET LOCAL request.jwt.claims='{}';"
        claims = json.dumps({'role': 'authenticated', 'sub': identity(user)})
        return f"SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{claims}';"

    def issue(user: int, request: int, org: int = 101, *, staff: str = 'coach') -> str:
        target = f"'{identity(org)}'" if staff == 'coach' else 'NULL'
        name = 'NULL' if staff == 'coach' else "'Synthetic race academy'"
        return f"SELECT public.issue_staff_invite('{identity(request)}','{staff}','race-{user}@test.invalid',{target},{name});"

    def accept(invite: dict) -> str:
        return f"SELECT public.accept_staff_invite('{invite['token']}','Synthetic race staff');"

    def response(output: str) -> dict:
        return json.loads(next(line for line in output.splitlines() if line.startswith('{')))

    def call(user: int, statement: str) -> dict:
        return response(sql('BEGIN;' + actor(user) + statement + 'COMMIT;').stdout)

    def denied(result: subprocess.CompletedProcess[str], code: str = '42501') -> None:
        assert result.returncode != 0 and code in result.stderr, result.stderr

    def race(first: str, first_user: int | None, second: str, second_user: int | None, label: str) -> subprocess.CompletedProcess[str]:
        """Commit the holder only after observing the follower blocked on its locks."""
        holder = subprocess.Popen(connection, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, env=env, cwd=ROOT)
        assert holder.stdin is not None and holder.stdout is not None
        follower_name = 'staff-race-' + label
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            holder.stdin.write("SET statement_timeout='15s'; BEGIN;\n" + actor(first_user) + '\n' + first
                               + "\nSELECT '{\"ready\":true}';\n")
            holder.stdin.flush()
            while True:
                line = holder.stdout.readline()
                if not line:
                    raise RuntimeError('First transaction failed: ' + holder.stderr.read()[-2000:])
                if line.strip() == '{"ready":true}':
                    break
            future = pool.submit(sql, f"SET application_name='{follower_name}'; SET statement_timeout='15s'; BEGIN;"
                                 + actor(second_user) + second + 'COMMIT;', check=False)
            blocked = False
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and not future.done():
                blocked = sql("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='"
                              + follower_name + "' AND cardinality(pg_blocking_pids(pid))>0);").stdout.strip() == 't'
                if blocked:
                    break
                time.sleep(0.03)
            assert blocked, 'No observed lock overlap: ' + label
            holder.stdin.write('COMMIT;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=10)
            result = future.result(timeout=20)
            assert holder.returncode == 0
            print('Observed native lock overlap:', label, flush=True)
            return result
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
            run([str(pg / 'createdb'), '-h', host, '-p', str(port), '-U', 'postgres', 'trak_staff_test'])
        # Refuse to load fixtures into a populated database, even on loopback.
        empty = sql("SELECT current_database()='trak_staff_test' AND to_regnamespace('auth') IS NULL "
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
            migration_sql = (ROOT / 'supabase/migrations' / filename).read_text()
            if args.falsify_recipient_lock and filename == '20260920111726_academy_staff_admission.sql':
                target = "  PERFORM pg_advisory_xact_lock(hashtextextended('staff-recipient:'||actor::text,0));"
                assert migration_sql.count(target) == 1
                migration_sql = migration_sql.replace(target, '')
            sql(migration_sql)
        for suite in ['parent_invite_security.sql', 'pilot_view_security.sql', 'privilege_and_consent_security.sql', 'staff_admission.sql']:
            sql("SET trak.test_database='disposable';\n" + (ROOT / 'supabase/tests' / suite).read_text())
            print('Native suite passed:', suite, flush=True)
        for user in range(1, 31):
            sql(f"INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('{identity(user)}','race-{user}@test.invalid',now());")
        sql(f"INSERT INTO trak_admission.platform_owners(user_id) VALUES('{identity(1)}');")
        for admin, org in [(2, 101), (3, 102)]:
            sql(f"INSERT INTO public.profiles(user_id,role,full_name) VALUES('{identity(admin)}','club','Synthetic admin');"
                f"INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES('{identity(org)}','{identity(admin)}','Race academy','RACE-{org}');")

        result = race(issue(6, 401), 2, issue(6, 401), 2, 'same-issue-request')
        assert result.returncode == 0, result.stderr
        assert response(result.stdout)['replayed'] is True and 'token' not in response(result.stdout)
        assert sql(f"SELECT count(*) FROM trak_admission.staff_invites WHERE request_id='{identity(401)}';").stdout.strip() == '1'

        invite = call(2, issue(7, 402))
        result = race(accept(invite), 7, accept(invite), 7, 'same-token')
        assert result.returncode == 0 and response(result.stdout)['replayed'] is True, result.stderr
        assert sql(f"SELECT count(*) FROM public.coach_details WHERE user_id='{identity(7)}';").stdout.strip() == '1'

        invite_a = call(2, issue(8, 403))
        invite_b = call(3, issue(8, 404, 102))
        result = race(accept(invite_a), 8, accept(invite_b), 8, 'two-academies-one-recipient')
        if args.falsify_recipient_lock:
            assert result.returncode == 0, result.stderr
            assert sql(f"SELECT count(*) FROM trak_admission.staff_invites WHERE accepted_by='{identity(8)}';").stdout.strip() == '2'
            print('Falsified: removing the recipient lock lets two academy invitations both succeed.', flush=True)
            return
        denied(result)
        assert sql(f"SELECT organization_id FROM public.coach_details WHERE user_id='{identity(8)}';").stdout.strip() == identity(101)
        assert sql(f"SELECT count(*) FROM trak_admission.staff_invites WHERE accepted_by='{identity(8)}';").stdout.strip() == '1'

        old = call(2, issue(9, 405))
        result = race(issue(9, 406), 2, accept(old), 9, 'resend-before-accept')
        denied(result)

        invite = call(2, issue(10, 407))
        revoke = f"SELECT public.revoke_staff_invite('{invite['invitation_id']}');"
        denied(race(revoke, 2, accept(invite), 10, 'revoke-before-accept'))

        invite = call(2, issue(11, 408))
        revoke = f"SELECT public.revoke_staff_invite('{invite['invitation_id']}');"
        denied(race(accept(invite), 11, revoke, 2, 'accept-before-revoke'), '22023')

        invite = call(1, issue(12, 409, staff='club'))
        disable = f"UPDATE trak_admission.platform_owners SET enabled=false WHERE user_id='{identity(1)}';"
        denied(race(disable, None, accept(invite), 12, 'owner-disabled-before-accept'))
        sql(f"UPDATE trak_admission.platform_owners SET enabled=true WHERE user_id='{identity(1)}';")

        invite = call(2, issue(13, 410))
        transfer = f"UPDATE public.organizations SET admin_user_id='{identity(3)}' WHERE id='{identity(101)}';"
        denied(race(transfer, None, accept(invite), 13, 'issuer-removed-before-accept'))
        sql(f"UPDATE public.organizations SET admin_user_id='{identity(2)}' WHERE id='{identity(101)}';")

        invite = call(2, issue(14, 411))
        change_email = f"UPDATE auth.users SET email='different@test.invalid' WHERE id='{identity(14)}';"
        denied(race(change_email, None, accept(invite), 14, 'recipient-email-changed-before-accept'))

        invite = call(1, issue(15, 412, staff='club'))
        result = race(accept(invite), 15, disable, None, 'accept-before-owner-disabled')
        assert result.returncode == 0, result.stderr
        assert sql(f"SELECT count(*) FROM public.organizations WHERE admin_user_id='{identity(15)}';").stdout.strip() == '1'
        assert sql("SELECT count(*) FROM trak_admission.staff_capabilities;").stdout.strip() == '0'
        print('Passed: 10 native staff-admission races; all four SQL suites.', flush=True)
    finally:
        if started:
            run([str(pg / 'pg_ctl'), '-D', str(scratch / 'data'), '-m', 'fast', '-w', 'stop'])
            print('Disposable native PostgreSQL stopped', flush=True)


if __name__ == '__main__':
    main()
