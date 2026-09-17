import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { RatingBandPill } from '@/lib/ratingBand';
import { Home, ClipboardList, PlaySquare, Brain, User, type LucideIcon } from 'lucide-react';

interface PlayerDetails {
  position: string | null;
  current_club: string | null;
  age_group: string | null;
  shirt_number: number | null;
  date_of_birth: string | null;
}

interface SeasonStats {
  matches: number;
  goals: number;
  assists: number;
  avgRating: number | null;
  wins: number;
  losses: number;
}

const PlayerProfile = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [details, setDetails] = useState<PlayerDetails | null>(null);
  const [stats, setStats] = useState<SeasonStats>({ matches: 0, goals: 0, assists: 0, avgRating: null, wins: 0, losses: 0 });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editName, setEditName] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editClub, setEditClub] = useState('');
  const [editAgeGroup, setEditAgeGroup] = useState('');
  const [editShirtNumber, setEditShirtNumber] = useState('');
  const [editNationality, setEditNationality] = useState('');

  useEffect(() => {
    if (!user) return;

    supabase.from('player_details').select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDetails(data);
          setEditPosition(data.position || '');
          setEditClub(data.current_club || '');
          setEditAgeGroup(data.age_group || '');
          setEditShirtNumber(data.shirt_number?.toString() || '');
        }
      });

    supabase.from('matches').select('*').eq('user_id', user.id)
      .then(({ data }) => {
        const matches = data || [];
        setStats({
          matches: matches.length,
          goals: matches.reduce((s, m) => s + (m.goals || 0), 0),
          assists: matches.reduce((s, m) => s + (m.assists || 0), 0),
          avgRating: matches.length > 0
            ? Math.round(matches.reduce((s, m) => s + Number(m.computed_rating), 0) / matches.length * 10) / 10
            : null,
          wins: matches.filter(m => m.team_score > m.opponent_score).length,
          losses: matches.filter(m => m.team_score < m.opponent_score).length,
        });
      });
  }, [user]);

  useEffect(() => {
    if (profile) {
      setEditName(profile.full_name || '');
      setEditNationality(profile.nationality || '');
    }
  }, [profile]);

  if (!profile || !user) return null;

  const initials = profile.full_name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '??';

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error: profileErr } = await supabase.from('profiles')
        .update({ full_name: editName, nationality: editNationality || null })
        .eq('user_id', user.id);
      if (profileErr) throw profileErr;

      const { error: detailsErr } = await supabase.from('player_details')
        .update({
          position: editPosition || null,
          current_club: editClub || null,
          age_group: editAgeGroup || null,
          shirt_number: editShirtNumber ? parseInt(editShirtNumber) : null,
        })
        .eq('user_id', user.id);
      if (detailsErr) throw detailsErr;

      toast.success('Profile updated');
      setEditing(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) return;
    navigate('/');
  };

  return (
    <div className="app-container flex flex-col min-h-screen">
      <div className="flex-1 px-[18px] pt-4 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate('/dashboard')} className="text-muted-foreground text-sm">← Back</button>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="text-xs text-primary font-medium border border-primary/30 rounded-lg px-3 py-1.5">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="text-xs text-primary-foreground bg-primary rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* Avatar + Name */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-medium border-2 border-primary/30 mb-3 bg-secondary">
            {initials}
          </div>
          {editing ? (
            <input value={editName} onChange={e => setEditName(e.target.value)}
              className="bg-secondary border border-border rounded-lg px-3 py-2 text-center text-foreground text-xl w-64" />
          ) : (
            <h1 className="text-2xl text-foreground">{profile.full_name}</h1>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {details?.position || '—'} · {details?.current_club || '—'}
          </p>
        </div>

        {/* Season Stats */}
        <div className="rounded-xl border border-border bg-card p-4 mb-4">
          <h3 className="section-label mb-3">Season Stats</h3>
          <div className="grid grid-cols-3 gap-3">
            <StatCell label="Played" value={stats.matches} />
            <StatCell label="Goals" value={stats.goals} />
            <StatCell label="Assists" value={stats.assists} />
            <div className="text-center rounded-lg py-2 bg-secondary flex flex-col items-center justify-center">
              {stats.avgRating !== null ? <RatingBandPill rating={stats.avgRating} /> : <p className="text-xl leading-none text-foreground">—</p>}
              <p className="section-label mt-1">Avg Rating</p>
            </div>
            <StatCell label="Wins" value={stats.wins} />
            <StatCell label="Losses" value={stats.losses} />
          </div>
        </div>

        {/* Personal Details */}
        <div className="rounded-xl border border-border bg-card p-4 mb-4">
          <h3 className="section-label mb-3">Personal Details</h3>
          <div className="space-y-3">
            <DetailRow label="Position" value={editPosition} editing={editing} onChange={setEditPosition} />
            <DetailRow label="Club" value={editClub} editing={editing} onChange={setEditClub} />
            <DetailRow label="Age Group" value={editAgeGroup} editing={editing} onChange={setEditAgeGroup} />
            <DetailRow label="Shirt Number" value={editShirtNumber} editing={editing} onChange={setEditShirtNumber} type="number" />
            <DetailRow label="Nationality" value={editNationality} editing={editing} onChange={setEditNationality} />
          </div>
        </div>

        {/* Sign Out */}
        <button onClick={handleSignOut}
          className="w-full rounded-xl border border-destructive/30 text-destructive py-3 text-sm font-medium hover:bg-destructive/10 transition-colors">
          Sign Out
        </button>
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card/95 backdrop-blur-xl border-t border-border px-2 py-2 z-50">
        <div className="flex justify-around items-center">
          <NavItem icon={Home} label="Home" onClick={() => navigate('/dashboard')} />
          <NavItem icon={ClipboardList} label="Log" onClick={() => navigate('/log')} />
          <NavItem icon={PlaySquare} label="Highlights" onClick={() => {}} />
          <NavItem icon={Brain} label="Goals" onClick={() => {}} />
          <NavItem icon={User} label="Profile" active onClick={() => {}} />
        </div>
      </nav>
    </div>
  );
};

const StatCell = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
  <div className="text-center rounded-lg py-2 bg-secondary">
    <p className={`text-xl leading-none ${color || 'text-foreground'}`}>{value}</p>
    <p className="section-label mt-1">{label}</p>
  </div>
);

const DetailRow = ({ label, value, editing, onChange, type = 'text' }: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void; type?: string;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-xs text-muted-foreground">{label}</span>
    {editing ? (
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="bg-secondary border border-border rounded-lg px-2 py-1 text-sm text-foreground text-right w-40" />
    ) : (
      <span className="text-sm text-foreground font-medium">{value || '—'}</span>
    )}
  </div>
);

const NavItem = ({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1 px-3 py-1 ${active ? '' : 'opacity-35'}`}>
    <Icon size={18} strokeWidth={1.75} className={active ? 'text-primary' : 'text-muted-foreground'} />
    <span className={`text-[10px] font-medium tracking-wide ${active ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
  </button>
);

export default PlayerProfile;
