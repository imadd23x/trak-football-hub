import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { RatingBandPill } from '@/lib/ratingBand';
import { PostMatchPrompt } from '@/components/coach/PostMatchPrompt';
import { Users, Calendar, Star, Home, BarChart3, FolderOpen, User as UserIcon, type LucideIcon } from 'lucide-react';

const CoachHome = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [coachDetails, setCoachDetails] = useState<any>(null);
  const [squadCount, setSquadCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [recentAssessments, setRecentAssessments] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from('coach_details').select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setCoachDetails(data));
    supabase.from('squad_players').select('id', { count: 'exact' }).eq('coach_user_id', user.id)
      .then(({ count }) => setSquadCount(count || 0));
    supabase.from('coach_sessions').select('id', { count: 'exact' }).eq('coach_user_id', user.id)
      .then(({ count }) => setSessionCount(count || 0));
    supabase.from('coach_assessments').select('*, squad_players(player_name, position)')
      .eq('coach_user_id', user.id).order('created_at', { ascending: false }).limit(3)
      .then(({ data }) => setRecentAssessments(data || []));
  }, [user]);

  if (!profile) return null;

  return (
    <div className="app-container flex flex-col min-h-screen">
      <div className="flex-1 px-[18px] pt-4 pb-24">
        {/* Post-match prompt — sits at the top, above the hero */}
        <div className="-ml-[18px]">
          <PostMatchPrompt />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl text-foreground">Coach Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {profile.full_name} · {coachDetails?.current_club || '—'}
            </p>
          </div>
          <button onClick={() => signOut()} className="text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:text-foreground transition-colors">
            Switch Account
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <StatBox label="Players" value={squadCount} color="text-gold" />
          <StatBox label="Sessions" value={sessionCount} color="text-primary" />
          <StatBox label="Pending" value={0} color="text-training-blue" />
        </div>

        {/* Quick Actions */}
        <p className="section-label mb-3">Quick Actions</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          <QuickAction icon={Users} label="Squad" onClick={() => navigate('/coach/squad')} />
          <QuickAction icon={Calendar} label="Log Session" onClick={() => navigate('/coach/sessions')} />
          <QuickAction icon={Star} label="Assess Player" onClick={() => navigate('/coach/assess')} />
        </div>

        {/* Recent Assessments */}
        <p className="section-label mb-3">Recent Assessments</p>
        {recentAssessments.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-4 text-center">
            <p className="text-xs text-muted-foreground">No assessments yet. Tap Assess Player to get started!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentAssessments.map((a) => (
              <div key={a.id} className="bg-card rounded-xl border border-border p-3 flex items-center justify-between"
                onClick={() => navigate('/coach/assess')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                    <UserIcon size={16} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-foreground font-medium">{(a.squad_players as any)?.player_name}</p>
                    <p className="text-[11px] text-muted-foreground">{(a.squad_players as any)?.position} · {new Date(a.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <RatingBandPill rating={Number(a.coach_rating)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CoachNav active="home" />
    </div>
  );
};

const StatBox = ({ label, value, color }: { label: string; value: number | string; color?: string }) => (
  <div className="bg-card border border-border rounded-[10px] p-3 text-center">
    <p className={`text-2xl leading-none ${color || 'text-foreground'}`}>{value}</p>
    <p className="section-label mt-1">{label}</p>
  </div>
);

const QuickAction = ({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) => (
  <button onClick={onClick}
    className="bg-card border border-border rounded-xl p-3 flex flex-col items-center gap-1.5 hover:border-primary/30 transition-colors active:scale-95">
    <Icon size={20} strokeWidth={1.75} className="text-foreground" />
    <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
  </button>
);

export const CoachNav = ({ active }: { active: string }) => {
  const navigate = useNavigate();
  const items: { id: string; icon: LucideIcon; label: string; path: string }[] = [
    { id: 'home',     icon: Home,        label: 'Home',     path: '/dashboard' },
    { id: 'squad',    icon: Users,       label: 'Squad',    path: '/coach/squad' },
    { id: 'sessions', icon: Calendar,    label: 'Sessions', path: '/coach/sessions' },
    { id: 'progress', icon: BarChart3,   label: 'Progress', path: '/coach/progress' },
    { id: 'more',     icon: FolderOpen,  label: 'More',     path: '/coach/more' },
  ];
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card/95 backdrop-blur-xl border-t border-border px-2 py-2 z-50">
      <div className="flex justify-around items-center">
        {items.map(i => {
          const Icon = i.icon;
          const isActive = active === i.id;
          return (
            <button key={i.id} onClick={() => navigate(i.path)}
              className={`flex flex-col items-center gap-1 px-3 py-1 ${isActive ? '' : 'opacity-35'}`}>
              <Icon size={18} strokeWidth={1.75} className={isActive ? 'text-coach-orange' : 'text-muted-foreground'} />
              <span className={`text-[10px] font-medium tracking-wide ${isActive ? 'text-coach-orange' : 'text-muted-foreground'}`}>{i.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default CoachHome;
