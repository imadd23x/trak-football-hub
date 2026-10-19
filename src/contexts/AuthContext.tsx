import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Session, User } from '@supabase/supabase-js';
import { setTelemetryRole, trackSessionOpen } from '@/lib/telemetry';
import { createOnboardingSession, type OnboardingSession } from '@/lib/onboarding-session';
import { useQueryClient } from '@tanstack/react-query';

type UserRole = 'player' | 'coach' | 'parent' | 'club';
const PENDING_PROFILE_KEY = 'trak_pending_profile';

interface PendingProfileData {
  role: UserRole;
  full_name: string;
  nationality: string | null;
  player_details?: {
    date_of_birth: string;
    position: string;
    current_club: string;
    age_group: string;
    shirt_number: number | null;
  };
  coach_details?: {
    current_club: string;
    team: string;
    coach_role: string;
    academy_code?: string;
  };
  club_details?: {
    academy_name: string;
  };
  parent_email?: string | null;
  coach_invite_code?: string | null;
}

interface Profile {
  id: string;
  user_id: string;
  role: UserRole;
  full_name: string;
  nationality: string | null;
  avatar_url?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, pendingProfile?: PendingProfileData) => Promise<{ user: User | null; error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: (expectedUserId?: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

const isValidRole = (value: unknown): value is UserRole => value === 'player' || value === 'coach' || value === 'parent' || value === 'club';

const parsePendingProfile = (value: unknown): PendingProfileData | null => {
  if (!value || typeof value !== 'object') return null;

  const data = value as Record<string, unknown>;
  if (!isValidRole(data.role) || typeof data.full_name !== 'string') return null;

  return {
    role: data.role,
    full_name: data.full_name,
    nationality: typeof data.nationality === 'string' ? data.nationality : null,
    player_details: data.player_details as PendingProfileData['player_details'] | undefined,
    coach_details: data.coach_details as PendingProfileData['coach_details'] | undefined,
    club_details: data.club_details as PendingProfileData['club_details'] | undefined,
    parent_email: typeof data.parent_email === 'string' ? data.parent_email : null,
    coach_invite_code: typeof data.coach_invite_code === 'string' ? data.coach_invite_code : null,
  };
};

const discardLegacyPendingProfile = () => {
  // This old key had no account owner. Never use it, even if it looks recent.
  try { localStorage.removeItem(PENDING_PROFILE_KEY); } catch { /* storage unavailable */ }
};

const readPendingProfileFromMetadata = (user: User): PendingProfileData | null => {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const pending = parsePendingProfile(metadata?.trak_onboarding);
  // Staff roles come only from the recipient-bound academy invitation RPC.
  // Old editable metadata must not provision or repair a staff identity.
  return pending?.role === 'coach' || pending?.role === 'club' ? null : pending;
};

async function writeProfileFromPendingData(
  account: OnboardingSession,
  data: PendingProfileData,
  isCurrent: () => boolean,
): Promise<Profile | null> {
  // Legacy parent/player provisioning uses one atomic server-side RPC. Staff use verified invitations.
  // It handles legacy player→coach and parent→child linking atomically while
  // household enrolment is being integrated. It must not create staff identities.
  if (!isCurrent()) return null;
  const { data: result, error } = await account.client.rpc('provision_my_profile' as any, {
    p: data as unknown as Record<string, unknown>,
  });
  if (error) throw error;
  if (!isCurrent()) return null;

  // Surface non-fatal warnings (e.g. unrecognised coach/academy code)
  const warnings = (result as { warnings?: string[] } | null)?.warnings ?? [];
  for (const w of warnings) toast.warning(w, { duration: 8000 });

  // provision_my_profile creates the parent_invites row; this mails it. It runs
  // here rather than at signup because the row does not exist until the RPC
  // above has run. Failure is deliberately non-fatal: the player still has the
  // share link on their home screen, and a child must never be left with a
  // half-created account because an email bounced.
  if (data.role === 'player' && data.parent_email) {
    // functions.invoke does NOT throw on a 4xx/5xx — it returns { data, error }.
    // The first version of this wrapped it in try/catch and awaited nothing
    // else, so the function could fail on every call and the browser showed
    // nothing. Read the actual outcome, log it in full, and tell the player
    // the truth: if the email did not go, they need to share the link instead.
    let sent = false;
    let detail = '';
    try {
      const { data: result, error } = await account.client.functions.invoke('send-parent-invite');
      let body = result as { sent?: boolean; via?: string; reason?: string; detail?: string } | null;
      if (error && !body) {
        // On a non-2xx the body is on the error's response, not in `data`.
        try { body = await (error as { context?: Response }).context?.json(); } catch { /* no body */ }
      }
      sent = body?.sent === true;
      detail = body?.detail ?? body?.reason ?? error?.message ?? '';
      console.info('[send-parent-invite]', { sent, via: body?.via, reason: body?.reason, detail, error: error?.message });
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
      console.error('[send-parent-invite] network failure', detail);
    }

    if (!isCurrent()) return null;

    if (!sent) {
      toast.warning(
        "We couldn't email your parent automatically. Share the invite link from your home screen instead.",
        { duration: 12000 },
      );
    }
    try {
      // Read by the player home screen so the waiting banner can offer the
      // share link only when it is actually needed.
      if (sent) localStorage.removeItem('trak_parent_invite_email_failed');
      else localStorage.setItem('trak_parent_invite_email_failed', detail || '1');
    } catch { /* storage unavailable — banner falls back to always showing the link */ }
  }

  if (!isCurrent()) return null;
  const { data: newProfile, error: profileError } = await account.client
    .from('profiles')
    .select('*')
    .eq('user_id', account.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!isCurrent()) return null;
  return (newProfile as unknown as Profile | null);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const activeSession = useRef<Session | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const hydration = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const authTransition = useRef<Promise<unknown> | null>(null);
  const explicitSignOut = useRef(false);

  // The SDK removes its shared session after the logout HTTP response. A
  // concurrent password sign-in can otherwise save B before A deletes it.
  // Serialize provider-owned transitions, including signup-created sessions.
  const runAuthTransition = <T,>(operation: () => Promise<T>): Promise<T> => {
    const previous = authTransition.current;
    const result = previous ? previous.then(operation, operation) : operation();
    authTransition.current = result;
    const finished = () => {
      if (authTransition.current === result) authTransition.current = null;
    };
    void result.then(finished, finished);
    return result;
  };

  const fetchOrCreateProfile = (session: Session, version: number): Promise<void> => {
    if (hydration.current?.generation === version) return hydration.current.promise;
    const isCurrent = () => mounted.current && generation.current === version
      && activeSession.current?.user.id === session.user.id;
    const promise = (async () => {
      try {
        const account = await createOnboardingSession(session);
        if (!isCurrent()) return;
        const { data, error } = await account.client
          .from('profiles').select('*').eq('user_id', account.user.id).maybeSingle();
        if (error) throw error;
        if (!isCurrent()) return;

        const existing = data as unknown as Profile | null;
        setProfile(existing);
        // Keep an existing account usable during its idempotent repair.
        if (existing) setLoading(false);
        const pending = readPendingProfileFromMetadata(account.user);
        if (pending && (!existing || pending.role === existing.role)) {
          const created = await writeProfileFromPendingData(account, pending, isCurrent);
          if (!isCurrent()) return;
          if (created) {
            setProfile(created);
            // Failure here is non-fatal: the next sign-in can repeat the
            // idempotent repair. This request is bound to this account's JWT.
            try { await account.clearPendingProfile(); } catch { /* retry next sign-in */ }
          }
        }
      } catch (err) {
        if (!isCurrent()) return;
        console.error('Failed to load account profile:', err);
        const message = err instanceof Error ? err.message : (err as { message?: string })?.message;
        toast.error(`Account setup hit a problem: ${message || 'unknown error'}. Pull to refresh or sign in again to retry.`);
      } finally {
        if (isCurrent()) {
          setLoading(false);
          hydration.current = null;
        }
      }
    })();
    hydration.current = { generation: version, promise };
    return promise;
  };

  const refreshProfile = async () => {
    const session = activeSession.current;
    if (session) await fetchOrCreateProfile(session, generation.current);
  };

  useEffect(() => {
    mounted.current = true;
    discardLegacyPendingProfile();
    let disposed = false;
    let receivedAuthEvent = false;
    let initialized = false;
    const initialGeneration = generation.current;
    const acceptSession = (session: Session | null) => {
      if (disposed) return;
      const previousUserId = activeSession.current?.user.id;
      const sameAccount = initialized && activeSession.current?.user.id === session?.user.id;
      initialized = true;
      activeSession.current = session;
      setUser(session?.user ?? null);
      // Token refresh, tab refocus and metadata changes must not unmount a
      // coach's unfinished form or start duplicate provisioning operations.
      if (sameAccount) return;
      if (previousUserId && previousUserId !== session?.user.id) queryClient.clear();
      const version = ++generation.current;
      hydration.current = null;
      setProfile(null);
      setLoading(!!session);
      if (session) void fetchOrCreateProfile(session, version);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      receivedAuthEvent = true;
      // Email confirmation now uses its own non-persistent Auth client.
      // Keep hydrating the app session on that route so returning to account
      // choice cannot leave loading=true after a suppressed INITIAL_SESSION.

      if (event === 'SIGNED_OUT') {
        acceptSession(null);
        queryClient.clear();
        discardLegacyPendingProfile();
        // Explicit callers own navigation. A hard reload here would discard
        // a queued sign-in and strip the current parent invitation URL.
        if (!explicitSignOut.current) window.location.replace('/');
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        // Hydrate the account even on reset, so a cross-tab switch cannot
        // leave the old family's profile/cache active when the form exits.
        acceptSession(session);
        if (window.location.pathname !== '/reset-password') window.location.replace('/reset-password');
        return;
      }

      acceptSession(session);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (disposed || receivedAuthEvent || generation.current !== initialGeneration) return;
      acceptSession(session);
    }).catch(() => {
      if (!disposed && !receivedAuthEvent && generation.current === initialGeneration) setLoading(false);
    });

    return () => {
      disposed = true;
      mounted.current = false;
      generation.current += 1;
      hydration.current = null;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  // Pilot instrumentation. One place, so every sign-in path is covered:
  // the role stamps subsequent events, and `app_opened` fires once per
  // browser session — the sole source for the week-6 return metrics.
  useEffect(() => {
    setTelemetryRole(profile?.role ?? null);
    if (user && profile) trackSessionOpen(user.id, profile.role);
  }, [user?.id, profile?.role]);

  const signUp = (email: string, password: string, pendingProfile?: PendingProfileData) => runAuthTransition(async () => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        ...(pendingProfile ? { data: { trak_onboarding: pendingProfile } } : {}),
      },
    });

    if (error && /already registered|already exists|user exists/i.test(error.message)) {
      return { user: null, error: new Error('An account with this email already exists. Please sign in instead.') };
    }

    return { user: data.user, error: error as Error | null };
  });

  const signIn = (email: string, password: string) => runAuthTransition(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  });

  const signOut = (expectedUserId?: string) => runAuthTransition(async () => {
    // A delayed Settings operation can queue behind another account's sign-in.
    // Check when this operation executes, before touching that account or SDK.
    if (expectedUserId && activeSession.current?.user.id !== expectedUserId) {
      return { error: new Error('Your account changed. Please try again.') };
    }
    explicitSignOut.current = true;
    const version = ++generation.current;
    hydration.current = null;
    discardLegacyPendingProfile();
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      // The SDK normally delivers SIGNED_OUT before this resolves. Do not
      // overwrite a newer account if another auth event has already arrived.
      if (mounted.current && generation.current === version) {
        activeSession.current = null;
        setUser(null);
        setProfile(null);
        setLoading(false);
        queryClient.clear();
      }
      return { error: null };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('Sign-out failed');
      if (mounted.current && generation.current === version) {
        setLoading(false);
        toast.error('Could not sign out. You are still signed in on this device. Check your connection and try again.');
      }
      return { error };
    } finally {
      explicitSignOut.current = false;
    }
  });

  return (
    <AuthContext.Provider value={{ user, profile, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
