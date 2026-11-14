import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { CoachNav } from './CoachHome';

const CoachSessions = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState('all');

  const [sessionType, setSessionType] = useState('');
  const [title, setTitle] = useState('');
  const [trainingType, setTrainingType] = useState('');
  const [competition, setCompetition] = useState('');
  const [venue, setVenue] = useState('');
  const [notes, setNotes] = useState('');

  const loadSessions = async () => {
    if (!user) return;
    const { data } = await supabase.from('coach_sessions').select('*').eq('coach_user_id', user.id).order('created_at', { ascending: false });
    setSessions(data || []);
  };

  useEffect(() => { loadSessions(); }, [user]);

  const handleCreateSession = async () => {
    if (!user || !sessionType || !title) return;
    const { error } = await supabase.from('coach_sessions').insert({
      coach_user_id: user.id,
      session_type: sessionType,
      title,
      training_type: sessionType === 'training' ? trainingType : null,
      competition: sessionType === 'match' ? competition : null,
      venue: sessionType === 'match' ? venue : null,
      notes: notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Session created!');
    setShowNew(false);
    setSessionType(''); setTitle(''); setTrainingType(''); setCompetition(''); setVenue(''); setNotes('');
    loadSessions();
  };

  const filtered = filter === 'all' ? sessions : sessions.filter(s => s.session_type === filter);

  return (
    <div className="app-container flex flex-col min-h-screen">
      <div className="flex-1 px-[18px] pt-4 pb-24">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[28px] text-foreground">Sessions</h1>
          <button onClick={() => setShowNew(!showNew)}
            className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-primary-foreground text-lg bg-primary">+</button>
        </div>

        {/* Filter */}
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {[{ k: 'all', l: 'All' }, { k: 'training', l: 'Training' }, { k: 'match', l: 'Matches' }].map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={`border rounded-lg py-2 text-[11px] font-medium transition-colors
                ${filter === f.k ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}>
              {f.l}
            </button>
          ))}
        </div>

        {/* New Session Form */}
        {showNew && (
          <div className="bg-card border border-border rounded-xl p-4 mb-4 space-y-3">
            <p className="section-label">Session Type</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[{ k: 'training', l: 'Training' }, { k: 'match', l: 'Match Day' }].map(t => (
                <button key={t.k} onClick={() => setSessionType(t.k)}
                  className={`border rounded-lg py-2.5 text-xs font-medium transition-colors
                    ${sessionType === t.k ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}>
                  {t.l}
                </button>
              ))}
            </div>

            {sessionType && (
              <>
                <Input placeholder={sessionType === 'training' ? 'e.g. Tuesday Training' : 'Opponent name'} value={title}
                  onChange={e => setTitle(e.target.value)} className="bg-secondary border-border" />

                {sessionType === 'training' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {['Technical', 'Tactical', 'Physical', 'Mixed'].map(t => (
                      <button key={t} onClick={() => setTrainingType(t)}
                        className={`border rounded-lg py-2 text-[11px] font-medium transition-colors
                          ${trainingType === t ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}

                {sessionType === 'match' && (
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      {['League', 'Tournament', 'Friendly'].map(c => (
                        <button key={c} onClick={() => setCompetition(c)}
                          className={`border rounded-lg py-2 text-[11px] font-medium transition-colors
                            ${competition === c ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {['Home', 'Away'].map(v => (
                        <button key={v} onClick={() => setVenue(v)}
                          className={`border rounded-lg py-2 text-[11px] font-medium transition-colors
                            ${venue === v ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <textarea placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-[10px] p-3 text-sm text-foreground outline-none focus:border-primary resize-none"
                  rows={3} />

                <button onClick={handleCreateSession} disabled={!title}
                  className="w-full rounded-[10px] py-3 bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
                  Create Session →
                </button>
              </>
            )}
          </div>
        )}

        {/* Session List */}
        <div className="space-y-2">
          {filtered.map(s => (
            <div key={s.id} className="bg-card border border-border rounded-xl p-3 cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => navigate(`/coach/session/${s.id}`)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(s.session_date || s.created_at).toLocaleDateString()} · {s.session_type === 'match' ? `${s.competition} · ${s.venue}` : s.training_type || 'Training'}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  s.session_type === 'match' ? 'bg-primary/20 text-primary' : 'bg-training-blue/15 text-training-blue'
                }`}>{s.session_type === 'match' ? 'Match' : 'Training'}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No sessions yet. Tap + to create one.</p>
            </div>
          )}
        </div>
      </div>
      <CoachNav active="sessions" />
    </div>
  );
};

export default CoachSessions;
