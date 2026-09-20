import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { IconRolePlayer, IconRoleCoach, IconRoleParent, IconRoleClub } from '@/components/icons/TrakIcons';
import { Eye, EyeOff } from 'lucide-react';
import { requireDevPassword } from '@/lib/dev-credentials';

const IS_DEV = import.meta.env.DEV;

const DEV_ACCOUNTS = [
  { role: 'coach',  label: 'Coach',  email: 'coach@trak.dev',  color: 'hsl(40,78%,60%)' },
  { role: 'player', label: 'Player', email: 'player@trak.dev', color: '#C8F25A' },
  { role: 'parent', label: 'Parent', email: 'parent@trak.dev', color: 'hsl(214,60%,57%)' },
  { role: 'club',   label: 'Admin',  email: 'club@trak.dev',   color: 'rgba(255,255,255,0.7)' },
] as const;

// Read from the environment, never a literal: this file is in the ENTRY bundle,
// so a literal here ships to every visitor of the production site.

type View = 'signin' | 'register';
function homeForRole(role: string | undefined): string | undefined {
  switch (role) {
    case 'player': return '/player/home';
    case 'coach': return '/coach/home';
    case 'parent': return '/parent/home';
    case 'club': return '/club/home';
    default: return undefined;
  }
}
const normalizedEmail = (email: string | undefined) => email?.trim().toLowerCase() ?? '';


// ─── Main page ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('signin');
  const { user, profile, loading } = useAuth();

  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  useEffect(() => {
    // A restored session or token refresh is not a navigation decision. Only a
    // successful password submission here may continue its matching account.
    if (!signedInEmail) return;
    if (!user) { if (!loading) setSignedInEmail(null); return; }
    if (normalizedEmail(user.email) !== signedInEmail) { setSignedInEmail(null); return; }
    const home = homeForRole(profile?.role);
    if (loading || !home) return;
    setSignedInEmail(null);
    navigate(home, { replace: true });
  }, [signedInEmail, loading, user, profile, navigate]);

  // /auth/confirm verifies the email in an isolated temporary session and
  // offers this sign-in link without changing a remembered account. The notice
  // explains the completed step so they do not reuse the confirmation link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('confirmed') !== '1') return;
    toast.success('Email confirmed — sign in to continue');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handleRoleSelect = (role: string) => {
    navigate(role === 'parent' ? '/parent-info' : `/onboarding/${role}`);
  };

  return (
    <div
      className="app-container relative flex flex-col min-h-screen overflow-hidden"
      style={{ background: '#0A0A0B' }}
    >
      {/* Ambient glow — top centre */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[420px] h-[320px] opacity-[0.07]"
        style={{
          background: 'radial-gradient(ellipse at center top, #C8F25A 0%, transparent 70%)',
        }}
      />

      <div className="relative flex flex-col items-center justify-center flex-1 px-6 py-12">

        {/* ── Wordmark ── */}
        <div className="text-center mb-12">
          <h1
            className="text-[72px] leading-none text-white/90 select-none"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 300,
              letterSpacing: '-0.04em',
            }}
          >
            TRAK
          </h1>
          <p
            className="text-[#C8F25A] italic mt-1 tracking-[0.14em]"
            style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 400 }}
          >
            football
          </p>
          <p
            className="mt-3 text-white/28 tracking-[0.08em] uppercase"
            style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}
          >
            Own your career
          </p>
        </div>

        {loading ? <p role="status" className="text-sm text-muted-foreground">Checking your account…</p>
          : user ? <AccountChoice key={user.id} onSwitch={() => { setSignedInEmail(null); setView('signin'); }} />
          : view === 'signin' ? <SignInForm onCreateAccount={() => setView('register')}
            onSignedIn={email => setSignedInEmail(normalizedEmail(email))} />
            : <RegisterView onRoleSelect={handleRoleSelect} onBack={() => setView('signin')} />}

        {/* ── Dev panel (localhost only) ── */}
        {IS_DEV && <DevLoginPanel />}

      </div>
    </div>
  );
}

function AccountChoice({ onSwitch }: { onSwitch: () => void }) {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'signout' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const home = homeForRole(profile?.role);
  const name = profile?.full_name?.trim() || user?.email || 'this account';

  async function switchAccount() {
    if (busy) return;
    onSwitch(); setBusy('signout'); setError(null);
    try {
      const result = await signOut();
      if (result.error) throw result.error;
    } catch {
      if (mounted.current) setError('Could not sign out. You are still signed in on this device. Try again.');
    } finally { if (mounted.current) setBusy(null); }
  }

  async function checkAccess() {
    if (busy) return;
    setBusy('refresh'); setError(null);
    // AuthContext owns lookup failures and displays its toast; this contract resolves.
    try { await refreshProfile(); }
    finally { if (mounted.current) setBusy(null); }
  }

  return <section aria-label="Choose an account" className="w-full space-y-4 text-foreground">
    <div className="rounded-xl border border-border bg-card p-4 space-y-2 break-words">
      <p className="text-sm text-muted-foreground">Signed in on this device</p>
      <h2 className="text-lg">{name}</h2>
      {user?.email && user.email !== name && <p className="text-sm text-muted-foreground">{user.email}</p>}
    </div>
    {home ? <button type="button" disabled={!!busy} onClick={() => navigate(home, { replace: true })}
      className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground p-3 font-medium break-words focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      Continue as {name}
    </button> : <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Your account access is not available yet. Open your academy invitation or check access again.</p>
      <button type="button" disabled={!!busy} onClick={() => { void checkAccess(); }}
        className="w-full min-h-11 rounded-xl border border-border p-3 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{busy === 'refresh' ? 'Checking access…' : 'Check access again'}</button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="button" disabled={!!busy} onClick={() => { void switchAccount(); }}
      className="w-full min-h-11 rounded-xl border border-border p-3 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      {busy === 'signout' ? 'Signing out…' : 'Sign in with another account'}
    </button>
  </section>;
}

// ─── Sign in form ─────────────────────────────────────────────────────────────

function SignInForm({ onCreateAccount, onSignedIn }: { onCreateAccount: () => void; onSignedIn: (email: string) => void }) {
  const { signIn } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const result = await signIn(email, password);
      if (result.error) throw result.error;
      onSignedIn(email);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in. Try again.');
    } finally { setLoading(false); }
  };

  const handleForgot = async () => {
    if (!email) { toast.error('Enter your email first'); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success('Check your email for a reset link');
  };

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">

      {/* Email */}
      <PremiumInput
        type="email"
        label="Email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />

      {/* Password */}
      <div className="relative">
        <PremiumInput
          type={showPw ? 'text' : 'password'}
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <button
          type="button"
          onClick={() => setShowPw(v => !v)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
          tabIndex={-1}
        >
          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {/* Forgot */}
      <button
        type="button"
        onClick={handleForgot}
        className="text-[11px] text-white/35 hover:text-[#C8F25A] transition-colors self-end -mt-1 tracking-[0.04em]"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        Forgot password?
      </button>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* CTA */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-[15px] rounded-[14px] text-[14px] font-semibold tracking-[0.04em] transition-all active:scale-[0.98] disabled:opacity-50 mt-1"
        style={{
          background: loading ? 'rgba(200,242,90,0.5)' : '#C8F25A',
          color: '#0A0A0B',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px bg-white/[0.07]" />
        <span
          className="text-white/22 text-[10px] tracking-[0.08em] uppercase"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          New to Trak?
        </span>
        <div className="flex-1 h-px bg-white/[0.07]" />
      </div>

      {/* Create account */}
      <button
        type="button"
        onClick={onCreateAccount}
        className="w-full py-[14px] rounded-[14px] text-[14px] font-medium transition-all active:scale-[0.98] border"
        style={{
          background: 'transparent',
          border: '1px solid rgba(200,242,90,0.2)',
          color: '#C8F25A',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        Create account
      </button>

    </form>
  );
}

// ─── Premium input ────────────────────────────────────────────────────────────

function PremiumInput({
  type, label, value, onChange, autoComplete,
}: {
  type: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);
  const id = label.toLowerCase().replace(/\s/g, '-');

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="absolute left-4 transition-all pointer-events-none"
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: focused || value ? 10 : 14,
          top: focused || value ? 10 : '50%',
          transform: focused || value ? 'none' : 'translateY(-50%)',
          color: focused ? '#C8F25A' : 'rgba(255,255,255,0.3)',
          letterSpacing: focused || value ? '0.08em' : '0',
          textTransform: focused || value ? 'uppercase' : 'none',
          fontWeight: focused || value ? 500 : 400,
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete={autoComplete}
        required
        className="w-full outline-none transition-all"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${focused ? 'rgba(200,242,90,0.35)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 14,
          padding: value || focused ? '24px 16px 10px' : '16px',
          fontSize: 15,
          color: 'rgba(255,255,255,0.88)',
          fontFamily: "'DM Sans', sans-serif",
          caretColor: '#C8F25A',
        }}
      />
    </div>
  );
}

// ─── Register view ────────────────────────────────────────────────────────────

function RegisterView({
  onRoleSelect,
  onBack,
}: {
  onRoleSelect: (role: string) => void;
  onBack: () => void;
}) {
  const roles = [
    {
      role: 'player',
      icon: <IconRolePlayer size={24} />,
      name: 'Player',
      desc: 'Track your career, log matches and earn your card',
      bg: 'rgba(200,242,90,0.08)',
      border: 'rgba(200,242,90,0.18)',
    },
    {
      role: 'coach',
      icon: <IconRoleCoach size={24} />,
      name: 'Coach',
      desc: 'Manage your squad, assess players and log sessions',
      bg: 'rgba(96,165,250,0.08)',
      border: 'rgba(96,165,250,0.18)',
    },
    {
      role: 'parent',
      icon: <IconRoleParent size={24} />,
      name: 'Parent',
      desc: "Follow your child's development and progress",
      bg: 'rgba(74,222,128,0.08)',
      border: 'rgba(74,222,128,0.18)',
    },
    {
      role: 'club',
      icon: <IconRoleClub size={24} />,
      name: 'Administrator',
      desc: 'Academy overview across all coaches and squads',
      bg: 'rgba(255,255,255,0.04)',
      border: 'rgba(255,255,255,0.10)',
    },
  ];

  return (
    <div className="w-full">
      <p
        className="text-[10px] tracking-[0.12em] uppercase text-white/35 mb-5 text-center"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        I am a…
      </p>

      <div className="flex flex-col gap-2.5">
        {roles.map(r => (
          <button
            key={r.role}
            onClick={() => onRoleSelect(r.role)}
            className="group w-full flex items-center gap-4 text-left rounded-[16px] px-4 py-[14px] transition-all active:scale-[0.98]"
            style={{
              background: r.bg,
              border: `1px solid ${r.border}`,
            }}
          >
            <div
              className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${r.border}` }}
            >
              {r.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-white/88 text-[16px] leading-tight"
                style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}
              >
                {r.name}
              </p>
              <p
                className="text-white/38 text-[11px] mt-0.5 leading-snug"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                {r.desc}
              </p>
            </div>
            <span className="text-white/25 text-lg group-hover:text-white/50 transition-colors">→</span>
          </button>
        ))}
      </div>

      <button
        onClick={onBack}
        className="w-full mt-6 text-[13px] text-white/35 hover:text-white/60 transition-colors text-center"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        ← Back to sign in
      </button>
    </div>
  );
}

// ─── Dev login panel (localhost only) ────────────────────────────────────────

const DEV_PIN = '013';

function DevLoginPanel() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin]           = useState('');
  const [shake, setShake]       = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);

  const handlePinChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 3);
    setPin(digits);
    if (digits.length === 3) {
      if (digits === DEV_PIN) {
        setUnlocked(true);
      } else {
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); }, 600);
      }
    }
  };

  const loginAs = async (account: typeof DEV_ACCOUNTS[number]) => {
    setBusyRole(account.role);
    await supabase.auth.signOut();
    const { error } = await signIn(account.email, requireDevPassword());
    if (error) {
      toast.error(`Dev login failed: ${error.message}`);
      setBusyRole(null);
    } else {
      navigate(`/${account.role}/home`, { replace: true });
    }
  };

  return (
    <div className="mt-10 w-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-px bg-white/[0.07]" />
        <span
          className="text-[9px] font-medium tracking-[0.12em] text-white/20 uppercase"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Dev quick-login
        </span>
        <div className="flex-1 h-px bg-white/[0.07]" />
      </div>

      {!unlocked ? (
        <div className="flex flex-col items-center gap-2">
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={e => handlePinChange(e.target.value)}
            placeholder="PIN"
            maxLength={3}
            className={`w-20 text-center py-2 rounded-[10px] text-[18px] tracking-[0.3em] outline-none transition-all ${shake ? 'animate-shake' : ''}`}
            style={{
              background: shake ? 'rgba(255,80,80,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1.5px solid ${shake ? 'rgba(255,80,80,0.35)' : 'rgba(255,255,255,0.08)'}`,
              color: 'rgba(255,255,255,0.6)',
              fontFamily: "'DM Mono', monospace",
            }}
            autoComplete="off"
          />
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Enter PIN to access
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            {DEV_ACCOUNTS.map(account => (
              <button
                key={account.role}
                onClick={() => loginAs(account)}
                disabled={busyRole !== null}
                className="rounded-[10px] py-3 text-center text-[11px] font-semibold transition-opacity disabled:opacity-50"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1.5px solid rgba(255,255,255,0.08)',
                  color: account.color,
                }}
              >
                {busyRole === account.role ? '…' : account.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigate('/dev-setup')}
            className="w-full text-[9px] text-white/25 hover:text-white/50 text-center mt-2 transition-colors"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            First time? Run setup → /dev-setup
          </button>
        </>
      )}
    </div>
  );
}
