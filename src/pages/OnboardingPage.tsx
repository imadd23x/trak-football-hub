import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { InvitedPlayerSetup } from '@/components/player/InvitedPlayerSetup';
import { supabase } from '@/integrations/supabase/client';

/** TRAK-101: Auth's redirect after a used or expired one-time link carries the error in the hash (or query). */
function linkUsedOrExpired(): boolean {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return ['error', 'error_code', 'error_description'].some(key => hash.has(key) || query.has(key));
}

// Someone with no session on a setup page: point them to their invitation, or,
// when the link they followed was already used or has expired, say so and
// offer Sign in (an account that finished setup signs in normally).
const InvitationHelp = ({ linkFailed }: { linkFailed: boolean }) => {
  const navigate = useNavigate();
  if (!linkFailed) {
    return <p className="text-sm text-muted-foreground">Open the invitation your academy emailed you to set up your account.</p>;
  }
  return (
    <div className="space-y-3">
      <h2 className="text-lg text-foreground">This link has already been used or has expired</h2>
      <p className="text-sm text-muted-foreground">If you already set up your account, sign in.</p>
      <Button className="w-full" onClick={() => navigate('/', { replace: true })}>Sign in</Button>
      <p className="text-sm text-muted-foreground">Ask your academy for a new link.</p>
    </div>
  );
};

const OnboardingPage = () => {
  const { role } = useParams<{ role: string }>();
  // TRAK-11 phase 4: a child who followed the roster's invitation arrives
  // signed in, with no password and no profile, so they finish setting up
  // instead of seeing the email signup form.
  const { user, profile, loading } = useAuth();
  const invited = !!user && !profile && !loading;
  // TRAK-101: Auth sends someone back here with the error in the link when it
  // was already used or has expired. Read once, before anything rewrites it.
  const [linkFailed] = useState(linkUsedOrExpired);
  // TRAK-12: staff are set up by Trak (#151 refuses a self-made coach or
  // academy admin), so these two addresses explain that instead of a form.
  if (role === 'coach' || role === 'club') return <StaffSetUpByTrak />;
  // TRAK-11: an account already set up in this role followed a sign-in link
  // (the roster invitation for someone who already has an account). Go home;
  // a guardian first picks up any child added for them since sign-up.
  if (!loading && profile?.role === 'parent' && role === 'parent') return <ExistingGuardianArrival />;
  if (!loading && profile?.role === 'player' && role === 'player') return <Navigate to="/player/home" replace />;
  // TRAK-11 phase 4: a guardian arrives from the roster invitation. There is
  // no guardian signup form; anyone else here is sent to their invitation.
  if (role === 'parent') return <GuardianOnboarding loading={loading} invited={invited} accountId={user?.id} linkFailed={linkFailed} />;
  if (role !== 'player') return <div className="app-container p-6 text-foreground">Invalid role</div>;

  // TRAK-101: there is no public player sign-up. A child joins from the
  // invitation their academy's roster sent (TRAK-48 refuses anyone else), so
  // with no session this page explains that instead of showing a form.
  return (
    <div className="app-container px-6 py-8">
      <a href="/" className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block">
        ← Back
      </a>
      <h1 className="text-2xl text-foreground mb-1">Player</h1>
      <p className="text-muted-foreground text-sm mb-6">Your academy added you to Trak</p>
      {loading
        ? <div role="status" aria-label="Loading" className="h-40 rounded-xl bg-card/50 animate-pulse" />
        : invited ? <InvitedPlayerSetup key={user?.id} /> : <InvitationHelp linkFailed={linkFailed} />}
    </div>
  );
};

// Claims the roster rows the academy added for this guardian after they signed
// up (the sign-up rule, in claim_my_roster_guardian_rows), then goes to parent
// home, which lists the new child for approval. A failure is shown, not skipped:
// home would otherwise miss the child.
const ExistingGuardianArrival = () => {
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setFailed(false);
    void supabase.rpc('claim_my_roster_guardian_rows' as never).then(({ error }) => {
      if (!current) return;
      if (error) setFailed(true);
      else navigate('/parent/home', { replace: true });
    });
    return () => { current = false; };
  }, [attempt, navigate]);
  return (
    <div className="app-container px-6 py-8">
      {failed ? <>
        <p role="alert" className="text-sm text-foreground mb-4">Couldn't add your new child to your account. Check your connection and try again.</p>
        <Button onClick={() => setAttempt(n => n + 1)}>Retry</Button>
      </> : <div role="status" aria-label="Loading" className="h-40 rounded-xl bg-card/50 animate-pulse" />}
    </div>
  );
};

const GuardianOnboarding = ({ loading, invited, accountId, linkFailed }: { loading: boolean; invited: boolean; accountId?: string; linkFailed: boolean }) => (
  <div className="app-container px-6 py-8">
    <a href="/" className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block">
      ← Back
    </a>
    <h1 className="text-2xl text-foreground mb-1">Parent or guardian</h1>
    <p className="text-muted-foreground text-sm mb-6">Your academy added you to Trak</p>
    {loading
      ? <div role="status" aria-label="Loading" className="h-40 rounded-xl bg-card/50 animate-pulse" />
      : invited
        ? <InvitedPlayerSetup key={accountId} role="parent" />
        : <InvitationHelp linkFailed={linkFailed} />}
  </div>
);


const StaffSetUpByTrak = () => (
  <div className="app-container px-6 py-8">
    <a href="/" className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block">
      ← Back
    </a>
    <h1 className="text-2xl text-foreground mb-2">Staff accounts</h1>
    <p className="text-muted-foreground text-sm leading-relaxed">
      Trak sets up coach and academy accounts. Ask your academy, and Trak will
      email you an invitation to sign in.
    </p>
  </div>
);

export default OnboardingPage;
