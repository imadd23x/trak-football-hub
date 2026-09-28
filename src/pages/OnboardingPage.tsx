import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { InvitedPlayerSetup } from '@/components/player/InvitedPlayerSetup';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  NATIONALITIES, POSITIONS, AGE_GROUPS, COACH_ROLES,
  DAYS, MONTHS, YEARS,
} from '@/lib/constants';
import { Mail, RefreshCw, ChevronDown } from 'lucide-react';
import { validatePassword, PASSWORD_HINT } from '@/lib/password'
import { ageFromDateOfBirth } from '@/lib/consent'
import { isRealCalendarDate, daysInMonth } from '@/lib/calendar'
import { ageGroupMatches, lowestEligibleAgeGroup } from '@/lib/age-group'

const StyledSelect = ({ value, onChange, placeholder, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) => (
  <div className="relative">
    <select
      value={value}
      onChange={onChange}
      className="w-full appearance-none bg-card border border-border rounded-xl px-4 py-3 pr-10 text-sm text-foreground outline-none focus:border-[#C8F25A]/30 transition-colors"
      {...props}
    >
      {children}
    </select>
    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
  </div>
);

type Role = 'player';

const EmailConfirmationScreen = ({ email }: { email: string }) => {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      setResent(true);
      toast.success('Confirmation email resent!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to resend email');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center py-6">
      <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6">
        <Mail className="w-10 h-10 text-primary" />
      </div>
      <h2 className="text-2xl text-foreground mb-2">Check your email</h2>
      <p className="text-sm text-muted-foreground mb-2">
        We sent a confirmation link to
      </p>
      <p className="text-sm font-medium text-foreground mb-6">{email}</p>
      <p className="text-xs text-muted-foreground mb-8">
        Click the link to activate your account and get started.
      </p>
      <Button
        variant="outline"
        onClick={handleResend}
        disabled={resending || resent}
        className="w-full gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${resending ? 'animate-spin' : ''}`} />
        {resent ? 'Email resent' : resending ? 'Resending...' : 'Resend confirmation email'}
      </Button>
      <a href="/" className="mt-6 text-sm text-muted-foreground hover:text-primary transition-colors">
        ← Back to home
      </a>
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
  // TRAK-12: staff are set up by Trak (#151 refuses a self-made coach or
  // academy admin), so these two addresses explain that instead of a form.
  if (role === 'coach' || role === 'club') return <StaffSetUpByTrak />;
  // TRAK-11 phase 4: a guardian arrives from the roster invitation. There is
  // no guardian signup form; anyone else here is sent to their invitation.
  if (role === 'parent') return <GuardianOnboarding loading={loading} invited={invited} />;
  const validRole = role === 'player' ? role as Role : null;

  if (!validRole) return <div className="app-container p-6 text-foreground">Invalid role</div>;

  const titles: Record<Role, string> = { player: 'Player' };

  return (
    <div className="app-container px-6 py-8">
      <a href="/" className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block">
        ← Back
      </a>
      <h1 className="text-2xl text-foreground mb-1">{titles[validRole]} Registration</h1>
      <p className="text-muted-foreground text-sm mb-6">Create your Trak account</p>
      {/* Until the session is known, show neither form: an invited child must
          not start typing into the signup form that is about to be replaced. */}
      {validRole === 'player' && (loading
        ? <div role="status" aria-label="Loading" className="h-40 rounded-xl bg-card/50 animate-pulse" />
        : invited ? <InvitedPlayerSetup /> : <PlayerOnboarding />)}
    </div>
  );
};

const GuardianOnboarding = ({ loading, invited }: { loading: boolean; invited: boolean }) => (
  <div className="app-container px-6 py-8">
    <a href="/" className="text-sm text-muted-foreground hover:text-primary mb-6 inline-block">
      ← Back
    </a>
    <h1 className="text-2xl text-foreground mb-1">Parent or guardian</h1>
    <p className="text-muted-foreground text-sm mb-6">Your academy added you to Trak</p>
    {loading
      ? <div role="status" aria-label="Loading" className="h-40 rounded-xl bg-card/50 animate-pulse" />
      : invited
        ? <InvitedPlayerSetup role="parent" />
        : <p className="text-sm text-muted-foreground">Open the invitation your academy emailed you to set up your account.</p>}
  </div>
);

const PlayerOnboarding = () => {
  const { signUp } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [nationality, setNationality] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [position, setPosition] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [shirtNumber, setShirtNumber] = useState('');

  // Built once from the three selects, so the age check and the value sent to
  // the database can never disagree.
  // Only offer days that exist in the chosen month, so 31 February cannot be
  // picked in the first place. Falls back to 31 until a month and year are set.
  const monthIndex = dobMonth ? MONTHS.indexOf(dobMonth) + 1 : 0;
  const availableDays = (dobMonth && dobYear)
    ? DAYS.slice(0, daysInMonth(parseInt(dobYear, 10), monthIndex))
    : DAYS;

  // If the day was chosen before the month, changing to a shorter month can
  // strand an impossible day in state. Drop it rather than submit it.
  useEffect(() => {
    if (dobDay && !availableDays.includes(dobDay)) setDobDay('');
  }, [dobDay, availableDays]);

  const dobIsReal = !!(dobDay && dobMonth && dobYear) &&
    isRealCalendarDate(parseInt(dobYear, 10), monthIndex, parseInt(dobDay, 10));

  const dateOfBirth = dobIsReal
    ? `${dobYear}-${String(monthIndex).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`
    : null;
  const age = dateOfBirth ? ageFromDateOfBirth(dateOfBirth) : null;

  const handleStep1 = () => {
    if (!name || !dobDay || !dobMonth || !dobYear || !nationality || !email || !password || !confirmPassword) {
      toast.error('Please fill in all fields'); return;
    }
    // An impossible date used to pass straight through: JavaScript rolls
    // 31 February over to 3 March rather than failing, so the age the consent
    // gate uses was never the date entered, and Postgres then rejected the
    // literal string and stranded signup on an error nobody could act on.
    if (!dobIsReal) {
      toast.error(`${dobMonth} ${dobDay} isn't a real date — please check your date of birth`);
      return;
    }
    if (age === null || age < 0 || age > 100) {
      toast.error('Please check your date of birth'); return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match'); return;
    }
    const pwError = validatePassword(password)
    if (pwError) { toast.error(pwError); return; }
    setStep(2);
  };

  // TRAK-18 phase 4 (consent-first spec): the Football step is the last one.
  // A rostered child's guardians come from the academy roster, never from the
  // child (G2), and the loader invites them (TRAK-11 phase 3), so there is no
  // Parent step and the signup carries no guardian address.
  const handleSubmit = async () => {
    if (!position || !ageGroup) {
      toast.error('Please fill in all required fields'); return;
    }
    // The age group and the date of birth were independent fields, so any
    // combination was accepted. Playing up a group is normal and stays allowed;
    // playing down is refused, because squad_player_consent_required() reads
    // date_of_birth and a band that contradicts it is a signal nobody reads.
    if (dateOfBirth && !ageGroupMatches(dateOfBirth, ageGroup)) {
      const lowest = lowestEligibleAgeGroup(dateOfBirth);
      toast.error(lowest
        ? `That date of birth doesn't fit ${ageGroup}. The youngest group you can join is ${lowest} — you can pick an older one.`
        : `That date of birth doesn't fit ${ageGroup}.`);
      return;
    }

    setLoading(true);
    try {
      const pendingProfile = {
        role: 'player' as const,
        full_name: name,
        nationality,
        // No club: the academy roster supplies it (TRAK-54, #144).
        player_details: {
          date_of_birth: dateOfBirth!,
          position,
          age_group: ageGroup,
          shirt_number: shirtNumber ? parseInt(shirtNumber, 10) : null,
        },
        // No coach code: the roster links the child's coach (TRAK-53).
        // No guardian address: the roster names the guardians (TRAK-18).
      };

      const { user, error } = await signUp(email, password, pendingProfile);
      if (error || !user) throw error || new Error('Signup failed');

      setStep(3);
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2 mb-4">
        <div className="flex gap-2">
          {[1, 2].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>
        <div className="flex justify-between">
          {['Personal', 'Football'].map((label, i) => (
            <span key={label} className={`text-[9px] uppercase tracking-wider ${i + 1 <= step ? 'text-primary' : 'text-white/22'}`}
              style={{ fontFamily: "'DM Mono', monospace" }}>{label}</span>
          ))}
        </div>
      </div>

      {step === 1 && (
        <>
          <Input placeholder="Full name" value={name} onChange={e => setName(e.target.value)} className="bg-card" />
          <p className="text-xs text-muted-foreground">Date of Birth</p>
          <div className="grid grid-cols-3 gap-2">
            <StyledSelect value={dobDay} onChange={e => setDobDay(e.target.value)}>
              <option value="">Day</option>
              {availableDays.map(d => <option key={d} value={d}>{d}</option>)}
            </StyledSelect>
            <StyledSelect value={dobMonth} onChange={e => setDobMonth(e.target.value)}>
              <option value="">Month</option>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </StyledSelect>
            <StyledSelect value={dobYear} onChange={e => setDobYear(e.target.value)}>
              <option value="">Year</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </StyledSelect>
          </div>
          <StyledSelect value={nationality} onChange={e => setNationality(e.target.value)}>
            <option value="">Select nationality</option>
            {NATIONALITIES.map(c => <option key={c} value={c}>{c}</option>)}
          </StyledSelect>
          <Input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="bg-card" />
          <PasswordInput label="New password" autoComplete="new-password" placeholder={PASSWORD_HINT} value={password} onChange={e => setPassword(e.target.value)} className="bg-card" />
          <PasswordInput label="Confirm password" autoComplete="new-password" placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="bg-card" />
          <Button onClick={handleStep1} className="w-full mt-2">Next</Button>
        </>
      )}

      {step === 2 && (
        <>
          <StyledSelect value={position} onChange={e => setPosition(e.target.value)}>
            <option value="">Select position</option>
            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </StyledSelect>
          <p className="text-xs text-muted-foreground">Your academy adds your club and coach.</p>
          <StyledSelect value={ageGroup} onChange={e => setAgeGroup(e.target.value)}>
            <option value="">Select age group</option>
            {AGE_GROUPS.map(a => <option key={a} value={a}>{a}</option>)}
          </StyledSelect>
          <Input type="number" placeholder="Shirt number (optional)" value={shirtNumber} onChange={e => setShirtNumber(e.target.value)} className="bg-card" />
          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
            <Button onClick={handleSubmit} disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create Account'}
            </Button>
          </div>
        </>
      )}

      {step === 3 && <EmailConfirmationScreen email={email} />}
    </div>
  );
};

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
