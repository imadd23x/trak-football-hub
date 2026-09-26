import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  NATIONALITIES, POSITIONS, AGE_GROUPS, COACH_ROLES,
  DAYS, MONTHS, YEARS,
} from '@/lib/constants';
import { Mail, RefreshCw, ChevronDown } from 'lucide-react';
import { validatePassword, PASSWORD_HINT } from '@/lib/password'
import { CONSENT_THRESHOLD_AGE, ageFromDateOfBirth } from '@/lib/consent'
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

/**
 * Shown instead of the plain confirmation screen to players below the
 * consent threshold. It must say only what is true at this moment: signUp has
 * returned, but for a duplicate email nothing was created, and even for a new
 * account the parent invite is created and mailed only on the player's first
 * sign-in after confirming (AuthContext → provision_my_profile →
 * send-parent-invite). So it tells the child the steps that trigger the parent
 * request instead of claiming it has already happened.
 */
export const AwaitingParentScreen = ({ email, parentEmail }: { email: string; parentEmail: string }) => (
  <div className="flex flex-col items-center text-center py-6">
    <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6">
      <Mail className="w-10 h-10 text-primary" />
    </div>
    <h2 className="text-2xl text-foreground mb-2">Almost there</h2>
    <p className="text-sm text-muted-foreground mb-2">
      Confirm your email at {email}. As soon as you're signed in, we'll ask
      your parent or guardian at
    </p>
    <p className="text-sm font-medium text-foreground mb-6">{parentEmail}</p>
    <p className="text-xs text-muted-foreground mb-8">
      to approve your account. As soon as they do, your coach can start
      recording your progress and you'll see it here.
    </p>
    <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
      ← Back to home
    </a>
  </div>
);

const OnboardingPage = () => {
  const { role } = useParams<{ role: string }>();
  // TRAK-12: staff are set up by Trak (#151 refuses a self-made coach or
  // academy admin), so these two addresses explain that instead of a form.
  if (role === 'coach' || role === 'club') return <StaffSetUpByTrak />;
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
      {validRole === 'player' && <PlayerOnboarding />}
    </div>
  );
};

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
  const [club, setClub] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [shirtNumber, setShirtNumber] = useState('');

  const [parentEmail, setParentEmail] = useState('');
  const [coachCode, setCoachCode] = useState('');

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
  const needsConsent = age !== null && age < CONSENT_THRESHOLD_AGE;

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

  const handleStep2 = () => {
    if (!position || !club || !ageGroup) {
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
    setStep(3);
  };

  const handleSubmit = async () => {
    // Below the digital-consent age a parent has to authorise before anything
    // can be recorded about them, so we cannot proceed without a way to reach
    // one. Above it the player consents for themselves and this never fires.
    if (needsConsent && !parentEmail.trim()) {
      toast.error("Please enter a parent or guardian's email so we can ask them to approve your account");
      return;
    }
    // G5: the request would go to the child, not a parent. The database refuses
    // it too, but only after the account exists, so stop it here.
    if (parentEmail.trim() && parentEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
      toast.error("Your parent's email must be different from yours");
      return;
    }

    setLoading(true);
    try {
      const pendingProfile = {
        role: 'player' as const,
        full_name: name,
        nationality,
        player_details: {
          date_of_birth: dateOfBirth!,
          position,
          current_club: club,
          age_group: ageGroup,
          shirt_number: shirtNumber ? parseInt(shirtNumber, 10) : null,
        },
        parent_email: parentEmail || null,
        coach_invite_code: coachCode.trim() || null,
      };

      const { user, error } = await signUp(email, password, pendingProfile);
      if (error || !user) throw error || new Error('Signup failed');

      setStep(4);
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
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>
        <div className="flex justify-between">
          {['Personal', 'Football', 'Parent'].map((label, i) => (
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
          <Input placeholder="Current club" value={club} onChange={e => setClub(e.target.value)} className="bg-card" />
          <StyledSelect value={ageGroup} onChange={e => setAgeGroup(e.target.value)}>
            <option value="">Select age group</option>
            {AGE_GROUPS.map(a => <option key={a} value={a}>{a}</option>)}
          </StyledSelect>
          <Input type="number" placeholder="Shirt number (optional)" value={shirtNumber} onChange={e => setShirtNumber(e.target.value)} className="bg-card" />
          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
            <Button onClick={handleStep2} className="flex-1">Next</Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-sm text-muted-foreground mb-2">
            Have a coach invite code? Enter it to link with your coach (optional).
          </p>
          <Input
            placeholder="Coach code e.g. TRK-AB2K (optional)"
            value={coachCode}
            onChange={e => setCoachCode(e.target.value.toUpperCase())}
            className="bg-card"
            maxLength={8}
          />
          {needsConsent ? (
            <>
              <p className="text-sm text-foreground mt-3 mb-1">
                You're under {CONSENT_THRESHOLD_AGE}, so a parent or guardian needs to approve your account first.
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                We'll email them. You can finish signing up now — you'll get in as soon as they say yes.
              </p>
              <Input
                type="email"
                placeholder="Parent or guardian's email"
                value={parentEmail}
                onChange={e => setParentEmail(e.target.value)}
                className="bg-card"
                required
              />
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mt-3 mb-2">
                Want to invite a parent? Enter their email below (optional).
              </p>
              <Input type="email" placeholder="Parent's email (optional)" value={parentEmail} onChange={e => setParentEmail(e.target.value)} className="bg-card" />
            </>
          )}
          <div className="flex gap-2 mt-2">
            <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Back</Button>
            <Button onClick={handleSubmit} disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create Account'}
            </Button>
          </div>
        </>
      )}

      {step === 4 && (
        needsConsent
          ? <AwaitingParentScreen email={email} parentEmail={parentEmail} />
          : <EmailConfirmationScreen email={email} />
      )}
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
