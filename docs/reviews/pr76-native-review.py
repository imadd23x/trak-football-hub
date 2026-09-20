from pathlib import Path
import argparse, json, os, socket, subprocess, tempfile
parser=argparse.ArgumentParser(description='Read-only PR #76 native replay with optional fixture-only corrections.')
parser.add_argument('--fixture-corrections',action='store_true')
args=parser.parse_args()
root=Path.cwd()
pg=Path('/opt/homebrew/opt/postgresql@17/bin')
tmp=Path(tempfile.mkdtemp(prefix='trak-pr76-native-'))
env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','TMPDIR','LANG')}
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
def run(cmd,text=None,check=True):
    r=subprocess.run(cmd,input=text,text=True,capture_output=True,env=env,cwd=root,timeout=120)
    if check and r.returncode: raise RuntimeError(r.stdout[-3000:]+r.stderr[-3000:])
    return r

def sql(db,text,check=True):
    return run([str(pg/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',str(port),'-U','postgres','-d',db],text,check)
def source(ref,path): return run(['git','show',ref+':'+path]).stdout
def migrations(ref):
    files=run(['git','ls-tree','--name-only',ref+':supabase/migrations']).stdout.splitlines()
    return {f:source(ref,'supabase/migrations/'+f) for f in files}
head='252b4869cd0adca45ab94c117d208cc3e1d3d9ce'
refs=[head,'8e72e80ac87b39670fa20c6dcf4e70b76bbadb69','c910829a088c0debaaf15c61ad897b1a77f00f84']
base=migrations(head);combined={}
for ref in refs:
    for f,body in migrations(ref).items():
        assert f not in combined or combined[f]==body, 'Migration collision: '+f
        combined[f]=body
suites=['parent_invite_security.sql','pilot_view_security.sql','privilege_and_consent_security.sql','match_stat_rules.sql']
more={'coach_notes_privacy.sql':refs[1],'org_referential_cleanup.sql':refs[1],'account_export.sql':refs[1],'staff_admission.sql':refs[2],'staff_delivery.sql':refs[2]}
started=False
try:
    run([str(pg/'initdb'),'-D',str(tmp/'data'),'-U','postgres','-A','trust','--no-locale'])
    run([str(pg/'pg_ctl'),'-D',str(tmp/'data'),'-l',str(tmp/'postgres.log'),'-o',f'-p {port} -h 127.0.0.1 -k {tmp}','-w','start']);started=True
    print(sql('postgres','SELECT version();').stdout.strip(),flush=True)
    for i,(label,files) in enumerate([('pr76',base),('combined',combined)]):
        db='trak_pr76_'+label
        run([str(pg/'createdb'),'-h','127.0.0.1','-p',str(port),'-U','postgres',db])
        assert sql(db,"SELECT to_regnamespace('auth') IS NULL;").stdout.strip()=='t'
        bootstrap=source(head,'supabase/tests/bootstrap.sql')
        if i: bootstrap='\n'.join(line for line in bootstrap.splitlines() if not line.startswith('CREATE ROLE '))
        sql(db,bootstrap)
        for f,body in sorted(files.items()): sql(db,body)
        print(label+': replayed '+str(len(files))+' migrations',flush=True)
        registry={s:head for s in suites}
        if i:
            registry.update(more);registry['pilot_view_security.sql']=refs[1]
            if args.fixture_corrections: registry['academy_isolation.sql']='918d8c3a250d0a5728aa60fc07430a9543b43f1c'
        failures=set()
        for suite,ref in registry.items():
            # staff suite includes a verdict inline, not a psql-relative include.
            body=source(ref,'supabase/tests/'+suite)
            if args.fixture_corrections and suite=='coach_notes_privacy.sql':
                body=body.replace('RESET ROLE;', "RESET ROLE; SET LOCAL request.jwt.claims='{}';")
            if args.fixture_corrections and suite=='account_export.sql':
                old='(user_id, opponent, match_date, position, competition, venue, age_group, goals, assists) VALUES'
                assert body.count(old)==1
                body=body.replace(old, '(user_id, opponent, match_date, position, competition, venue, age_group, goals, assists, minutes_played, team_score) VALUES')
                for old,new in [("'mid', 'League', 'Home', 'U15', 1, 0)", "'mid', 'League', 'Home', 'U15', 1, 0, 90, 2)"), ("'def', 'League', 'Away', 'U15', 0, 1)", "'def', 'League', 'Away', 'U15', 0, 1, 90, 2)")]:
                    assert body.count(old)==1;body=body.replace(old,new)
            result=sql(db,"SET trak.test_database='disposable';\n"+body,False)
            print(label+': '+suite+' '+('PASS' if result.returncode==0 else 'FAIL'),flush=True)
            if result.returncode:
                failures.add(suite)
                if suite=='coach_notes_privacy.sql': assert 'Owner-issued academy invitation required' in result.stderr
                if suite=='account_export.sql': assert 'matches_goals_within_team_score' in result.stderr
                print(result.stdout[-1000:]+result.stderr[-4000:],flush=True)
        expected={'coach_notes_privacy.sql','account_export.sql'} if i and not args.fixture_corrections else set()
        assert failures==expected, (label,failures,expected)
        constraints=sql(db,"SELECT conname||':'||convalidated FROM pg_constraint WHERE conrelid='public.matches'::regclass AND conname LIKE 'matches_%' ORDER BY conname;").stdout
        print(constraints,flush=True)
    print('No production access; review-only replay finished.',flush=True)
finally:
    if started: run([str(pg/'pg_ctl'),'-D',str(tmp/'data'),'-m','fast','-w','stop'])
    print('Disposable PostgreSQL stopped. '+str(tmp),flush=True)
