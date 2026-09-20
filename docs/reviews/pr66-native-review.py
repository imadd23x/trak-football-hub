from pathlib import Path
import json, os, socket, subprocess, tempfile

root = Path.cwd()
pg = Path('/opt/homebrew/opt/postgresql@17/bin')
tmp = Path(tempfile.mkdtemp(prefix='trak-pr66-native-'))
env = {k:v for k,v in os.environ.items() if k in ('PATH','HOME','TMPDIR','LANG')}
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]

def run(cmd, body=None, check=True):
    result = subprocess.run(cmd, input=body, text=True, capture_output=True, env=env, cwd=root, timeout=120)
    if check and result.returncode:
        raise RuntimeError(result.stdout[-3000:] + result.stderr[-3000:])
    return result

def sql(db, body, check=True):
    return run([str(pg/'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', str(port), '-U', 'postgres', '-d', db], body, check)

def source(ref, path):
    return run(['git','show', ref+':'+path]).stdout

def migrations(ref):
    return {name:source(ref, 'supabase/migrations/'+name) for name in run(['git','ls-tree','--name-only',ref+':supabase/migrations']).stdout.splitlines()}

def union(*sets):
    out = {}
    for migration_set in sets:
        for name, body in migration_set.items():
            assert name not in out or out[name] == body, 'Changed historical migration: '+name
            out[name] = body
    return out

main='4335e8984777b7b704e8706d3fe277352658c9ed'
head='404e729a1f7cae728e14e61ba4424fb96b7c9ef9'
coach='8e72e80ac87b39670fa20c6dcf4e70b76bbadb69'
staff='c910829a088c0debaaf15c61ad897b1a77f00f84'
match='252b4869cd0adca45ab94c117d208cc3e1d3d9ce'
base=migrations(head)
released=migrations(main)
combined=union(base,migrations(coach))
all_pending=union(combined,migrations(staff),migrations(match))
bootstrap=source(head,'supabase/tests/bootstrap.sql')
suite=source(head,'supabase/tests/pilot_scope.sql')
probe="""
SELECT json_build_object(
 'published_fixture_rows',(SELECT count(*) FROM public.pilot_match_coverage WHERE fixture_id=pg_temp.sid(301)),
 'unpublished_fixture_rows',(SELECT count(*) FROM public.pilot_match_coverage WHERE fixture_id=pg_temp.sid(303)),
 'assessment_rows',(SELECT count(*) FROM public.pilot_assessment_rate),
 'rating_rows',(SELECT count(*) FROM public.pilot_rating_agreement_derived));
"""
assert suite.count('ROLLBACK;') == 1
suite=suite.replace('ROLLBACK;',probe+'\nROLLBACK;')
log=[]

def check_suite(db, label, expected_ok):
    result=sql(db,"SET trak.test_database='disposable';\n"+suite,False)
    outcome={'label':label,'exit':result.returncode,'details':result.stderr.strip(),'rows':result.stdout.strip()}
    log.append(outcome)
    print(json.dumps(outcome),flush=True)
    assert (result.returncode == 0) == expected_ok, outcome
    return outcome

started=False
try:
    run([str(pg/'initdb'),'-D',str(tmp/'data'),'-U','postgres','-A','trust','--no-locale'])
    run([str(pg/'pg_ctl'),'-D',str(tmp/'data'),'-l',str(tmp/'postgres.log'),'-o',f'-p {port} -h 127.0.0.1 -k {tmp}','-w','start'])
    started=True
    print(sql('postgres','SELECT version();').stdout.strip(),flush=True)
    histories=[('standalone', [base]), ('with_pr44', [combined]), ('released_upgrade', [released,{n:b for n,b in combined.items() if n not in released}]), ('with_staff_and_match', [all_pending])]
    for i,(label,stages) in enumerate(histories):
        db='trak_pr66_'+label
        run([str(pg/'createdb'),'-h','127.0.0.1','-p',str(port),'-U','postgres',db])
        assert sql(db,"SELECT to_regnamespace('auth') IS NULL;").stdout.strip()=='t'
        boot=bootstrap if i==0 else '\n'.join(line for line in bootstrap.splitlines() if not line.startswith('CREATE ROLE '))
        sql(db,boot)
        for stage in stages:
            for name,body in sorted(stage.items()):
                sql(db,body)
        print(label+': '+str(sum(len(s) for s in stages))+' migrations',flush=True)
        baseline=check_suite(db,label,True)
        assert '22 of 22 assertions passed' in baseline['details']
        if label=='with_pr44':
            published=source(coach,'supabase/migrations/20260919160000_split_match_coverage_by_logger.sql')
            assert published.count('    AND e.published')==1
            sql(db,published.replace('    AND e.published',''))
            mutant=check_suite(db,'remove_published_filter',True)
            assert '22 of 22 assertions passed' in mutant['details']
            assert '"unpublished_fixture_rows" : 1' in mutant['rows'],mutant
            sql(db,published)
            # Negative control: remove the academy filter, the suite must detect it.
            original=sql(db,"SELECT pg_get_functiondef('public.pilot_coach_ids()'::regprocedure);").stdout
            sql(db,"CREATE OR REPLACE FUNCTION public.pilot_coach_ids() RETURNS TABLE(coach_user_id uuid) LANGUAGE sql STABLE SET search_path=public AS $$ SELECT cd.user_id FROM public.coach_details cd $$;")
            mutant=check_suite(db,'remove_academy_filter',False)
            assert 'B1 scoped' in mutant['details'] and 'Pilot scope:' in mutant['details']
            sql(db,original)
            # Independent candidate: check #44's added public contract, not the filter text.
            candidate=suite.replace("pg_get_viewdef('public.pilot_match_coverage'::regclass) NOT ILIKE '%published%'", "NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pilot_match_coverage' AND column_name='logged_by_coach')")
            assert candidate != suite
            result=sql(db,"SET trak.test_database='disposable';\n"+candidate,False)
            assert result.returncode==0, result.stderr
            sql(db,published.replace('    AND e.published',''))
            result=sql(db,"SET trak.test_database='disposable';\n"+candidate,False)
            assert result.returncode!=0 and 'D0b' in result.stderr,result.stderr
            print('Contract-version marker candidate: baseline PASS, filter-removal mutant CAUGHT. Proposal only; no peer branch edited.',flush=True)
            sql(db,published)
    (tmp/'results.json').write_text(json.dumps(log,indent=2))
    print('Review complete. No remote database, Auth, email or application source writes.',flush=True)
finally:
    if started:
        run([str(pg/'pg_ctl'),'-D',str(tmp/'data'),'-m','fast','-w','stop'])
    print('Disposable PostgreSQL stopped. '+str(tmp),flush=True)
