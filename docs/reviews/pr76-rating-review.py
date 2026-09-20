from pathlib import Path
import io, subprocess, sys, tarfile, tempfile
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip() == '146bf167a1526ba6fe856973326af77ddab1ecaa', 'Reconcile the test before reviewing a different head'
archive=subprocess.check_output(['git','archive','HEAD'],cwd=root)
with tempfile.TemporaryDirectory(prefix='trak-pr76-rating-review-') as tmp:
    stage=Path(tmp).resolve()
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar: tar.extractall(stage,filter='data')
    (stage/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
    page=stage/'src/pages/coach/CoachAddSession.tsx';source=page.read_text()
    cases=[('goals', 'goalsKey(pos, d.goals)', "(d.goals >= 2 ? '2+' : String(d.goals))", 'stores the exact count'),
           ('assists', 'assistsKey(d.assists)', 'goalsKey(pos, d.assists)', 'keys assists')]
    for name,old,new,expected in cases:
        assert source.count(old)==1
        page.write_text(source.replace(old,new,1))
        r=subprocess.run(['npx','vitest','run','src/pages/coach/__tests__/match-write-path.test.tsx','--reporter=dot'],cwd=stage,capture_output=True,text=True,timeout=60)
        log=r.stdout+r.stderr;Path('/tmp/trak-pr76-146-mutation-'+name+'.log').write_text(log)
        assert r.returncode==1 and expected in log and 'expected 6.9 to be greater than 6.9' in log,log[-3000:]
        print(name+': incorrect mapping caught by rendered request regression')
    page.write_text(source)
    print('Peer checkout unchanged; temporary mutation checkout removed.')
