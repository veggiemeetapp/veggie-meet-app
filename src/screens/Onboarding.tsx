import { memberSafeMessage } from "@/lib/errors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Camera,
  Check,
  Heart,
  ImagePlus,
  Mail,
  MapPin,
  Shield,
  Shuffle,
  Sparkles,
  Sprout,

  Trash2,
  Users,
  Utensils,
} from "lucide-react";
import { PrimaryButton, BackButton } from "@/components/app";
import { UserAvatar } from "@/components/app/UserAvatar";
import { CitySelector } from "@/components/location/CitySelector";
import { cn } from "@/lib/utils";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSetHomeCity, useSetSelectedCity } from "@/hooks/useLocation";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DIETARY_OPTIONS,
  ONBOARDING_PROGRESS_STEPS,
  ONBOARDING_STEP_ORDER,
  type DietaryIdentity,
  type InterestOption,
  type OnboardingStep,
  type StartingOptions,
  type StartingPointOption,
  completeOnboarding,
  fetchInterestCatalogue,
  fetchOnboardingState,
  fetchStartingOptions,
  logOnboardingEvent,
  saveOnboardingStep,
} from "@/lib/onboarding";
import { acceptCommunityGuidelines, updateMyProfile, type ProfileEditInput } from "@/lib/profile";
import {
  consumePostAuthPath,
  sanitizeInternalPath,
  stashPostAuthPath,
} from "@/lib/authRedirect";


// (legacy `ONBOARDED_KEY` localStorage flag removed — route gating uses the server profile only.)
import { MAX_INTERESTS, MIN_INTERESTS } from "@/lib/onboarding";
import { InterestPicker } from "@/components/interests/InterestPicker";
import { lovable } from "@/integrations/lovable/index";
import { mapAuthError } from "@/lib/authErrors";
import { PasswordField } from "@/components/auth/PasswordField";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { PASSWORD_MIN_LENGTH, isPasswordLongEnough } from "@/lib/passwordPolicy";



// WO-143: sample avatars are the bundled, approved VeggieMeet cartoon set —
// no third-party generated images, and never an initial-letter fallback.
import {
  PLATFORM_AVATARS,
  platformAvatarToken,
  platformAvatarTokenForSeed,
  isPlatformAvatarToken,
} from "@/lib/avatar";


// Public-facing action route for each starting-point option.
function actionRoute(opt: StartingPointOption): string {
  switch (opt.entity_type) {
    case "veggie":
      return `/veggie/${opt.entity_id}`;
    case "meetup":
      return `/meetup/${opt.entity_id}`;
    case "place":
      return `/place/${opt.entity_id}`;
  }
}

function actionLabel(opt: StartingPointOption): string {
  switch (opt.action_type) {
    case "connect":
      return "Say hi";
    case "join":
      return "Join";
    case "view":
      return "Support";
  }
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // WO-073: `?next=` is attacker-controllable, so it goes through a single
  // strict sanitizer that only accepts rooted same-origin relative paths.
  // A destination surviving sanitation is still authorization-gated by
  // `RequireOnboarded` (and, for owner routes, the server-side owner check).
  // A full-page OAuth round trip loses the query string, so a stashed
  // per-tab copy is used as fallback.
  const nextPath = useMemo(
    () => sanitizeInternalPath(searchParams.get("next")) ?? consumePostAuthPath(),
    [searchParams],
  );
  const resumeStep = useMemo(() => {
    const raw = searchParams.get("resume") as OnboardingStep | null;
    return raw && ONBOARDING_STEP_ORDER.includes(raw) ? raw : null;
  }, [searchParams]);

  const { session, profile, refreshProfile } = useAuth();
  const setHomeCityMut = useSetHomeCity();
  const setSelectedMut = useSetSelectedCity();

  // WO-099: a signed-out member who taps a policy link from the auth surface
  // must come back to the auth surface, not the splash. The policy links stamp
  // `?resume=auth` onto the current history entry, so Back restores it here.
  // Signed-in members are unaffected: the hydration effect below still forces a
  // post-auth step and never restores `welcome`/`auth`.
  const [step, setStep] = useState<OnboardingStep>(() =>
    resumeStep === "auth" ? "auth" : "welcome",
  );
  const [authIntent, setAuthIntent] = useState<"signup" | "signin">("signup");
  const [hydrated, setHydrated] = useState(false);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [bio, setBio] = useState("");
  const [dietary, setDietary] = useState<DietaryIdentity | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [homeCityId, setHomeCityId] = useState<string | null>(null);
  const [homeCityName, setHomeCityName] = useState<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedCityName, setSelectedCityName] = useState<string | null>(null);
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrate from profile + onboarding state
  useEffect(() => {
    if (!profile) return;
    if (nextPath) {
      navigate(nextPath, { replace: true });
      return;
    }
    if (profile.onboarding_completed && !resumeStep) {
      navigate("/", { replace: true });
      return;
    }
    setDisplayName((n) => n || profile.display_name || "");
    setBio((b) => b || profile.bio || "");
    // WO-143: every member always has an avatar — fall back to the stable
    // platform cartoon avatar derived from the profile id.
    setAvatarUrl((a) => a || profile.avatar_url || platformAvatarTokenForSeed(profile.id));

    setInterests((i) => (i.length ? i : (profile.interests || []).slice(0, MAX_INTERESTS)));
    setHomeCityId((c) => c ?? profile.home_city_id ?? null);
    // Explicit resume-to-single-step (existing-user migration).
    if (resumeStep) {
      setStep(resumeStep);
      setHydrated(true);
      return;
    }
    // WO-080: a signed-in member has already cleared the pre-auth steps, so
    // `welcome`/`auth` must never be restored — that bounced brand-new accounts
    // (whose server step is still `welcome`) straight back to the splash after
    // signup. Anything past auth resumes verbatim; `done` is handled above.
    const firstPostAuthStep: OnboardingStep = "identity";
    if (step === "welcome" || step === "auth") setStep(firstPostAuthStep);
    if (!hydrated) {
      fetchOnboardingState()
        .then((s) => {
          const candidate = s?.current_step as OnboardingStep | undefined;
          if (
            candidate &&
            candidate !== "done" &&
            candidate !== "welcome" &&
            candidate !== "auth" &&
            ONBOARDING_STEP_ORDER.includes(candidate)
          ) {
            setStep(candidate);
          } else {
            setStep(firstPostAuthStep);
          }
        })
        .catch(() => undefined)
        .finally(() => setHydrated(true));
    }

  }, [profile, navigate, nextPath, resumeStep, hydrated]);

  const stepIndex = ONBOARDING_STEP_ORDER.indexOf(step);
  const progressIndex = ONBOARDING_PROGRESS_STEPS.indexOf(step);
  const showProgress = progressIndex >= 0;
  const showBack = step !== "welcome" && step !== "done";

  // Track step views (fire-and-forget)
  //
  // DEF-084A-04: an already-onboarded member who simply signs in mounts this
  // screen for one frame before the redirect above runs, which emitted a bogus
  // `onboarding_step_viewed{step:"identity"}` and inflated the first-run funnel.
  // A step view is only real once (a) the resolved step is hydrated and (b) the
  // member is genuinely still in onboarding.
  const lastLogged = useRef<OnboardingStep | null>(null);
  const redirecting = !!profile && (!!nextPath || (profile.onboarding_completed && !resumeStep));
  useEffect(() => {
    if (redirecting) return;
    if (step !== "welcome" && step !== "auth" && !hydrated) return;
    if (lastLogged.current === step) return;
    lastLogged.current = step;
    logOnboardingEvent("onboarding_step_viewed", { step });
  }, [step, hydrated, redirecting]);

  const advance = useCallback(
    async (from: OnboardingStep, to: OnboardingStep, opts?: { skipped?: boolean }) => {
      try {
        if (session) {
          await saveOnboardingStep(from, {
            completed: !opts?.skipped,
            skipped: !!opts?.skipped,
            next: to,
          });
        }
      } catch {
        // Non-blocking: local flow proceeds even if persistence hiccups.
      }
      logOnboardingEvent("onboarding_step_completed", { step: from, skipped: !!opts?.skipped });
      setStep(to);
    },
    [session],
  );

  function goBack() {
    if (stepIndex <= 0) return;
    const prev = ONBOARDING_STEP_ORDER[stepIndex - 1];
    if (prev === "auth" && session) {
      setStep("welcome");
      return;
    }
    setStep(prev);
  }

  // Persist a partial profile field on step completion — keeps DB and UI in sync.
  // WO-072: members hold no UPDATE privilege on `profiles`; every write goes
  // through the `update_my_profile` RPC, which derives the actor from auth and
  // validates each field server-side.
  async function persistProfilePartial(patch: ProfileEditInput) {
    if (!session?.user) return;
    await updateMyProfile(patch);
    await refreshProfile();
  }


  async function handleIdentityContinue() {
    if (!displayName.trim()) return;
    try {
      await persistProfilePartial({
        displayName: displayName.trim(),
        pronouns: pronouns.trim() || null,
      });

      await advance("identity", "dietary");
    } catch (e) {
      toast.error("Couldn't save your name", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handleDietaryContinue() {
    if (!dietary) return;
    try {
      await persistProfilePartial({ dietaryIdentity: dietary });
      await advance("dietary", "home_city");
    } catch (e) {
      toast.error("Couldn't save that yet", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handleHomeCityContinue() {
    if (!homeCityId) return;
    try {
      await setHomeCityMut.mutateAsync(homeCityId);
      // Prefill Selected City to Home City as a friendly default; user
      // can change it on the next step. Home City and Selected City are
      // independent thereafter — neither silently overwrites the other.
      if (!selectedCityId) {
        setSelectedCityId(homeCityId);
        setSelectedCityName(homeCityName);
        await setSelectedMut.mutateAsync(homeCityId).catch(() => undefined);
      }
      await advance("home_city", "selected_city");
    } catch (e) {
      toast.error("Couldn't save your city", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handleSelectedCityContinue() {
    if (!selectedCityId) return;
    try {
      await setSelectedMut.mutateAsync(selectedCityId);
      await advance("selected_city", "interests");
    } catch (e) {
      toast.error("Couldn't save your city", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handleInterestsContinue() {
    if (interests.length < MIN_INTERESTS || interests.length > MAX_INTERESTS) return;
    try {
      await persistProfilePartial({ interests });
      await advance("interests", "photo");
    } catch (e) {
      toast.error("Couldn't save your interests", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handlePhotoContinue(skipped: boolean) {
    try {
      await persistProfilePartial({ avatarUrl, clearAvatar: !avatarUrl });
      await advance("photo", "guidelines", { skipped });
    } catch (e) {
      toast.error("Couldn't save your photo", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handleGuidelinesContinue() {
    if (!guidelinesAccepted) return;
    try {
      // Server-authoritative timestamp — clients cannot forge or back-date it.
      await acceptCommunityGuidelines();
      await refreshProfile();
      await advance("guidelines", "safety");

    } catch (e) {
      toast.error("Couldn't save that yet", {
        description: memberSafeMessage(e),
      });
    }
  }

  async function handleSafetyContinue() {
    await advance("safety", "starting_point");
  }

  async function finish(action?: { route: string; label: string; entity_type: string; entity_id: string }) {
    if (saving) return;
    setSaving(true);
    // WO-095: the mock-user mirror is gone; the profile row is the only source.


    try {
      if (session?.user) {
        await completeOnboarding();
        await refreshProfile();
      }
      // (legacy `veggiemeet_onboarded` localStorage flag removed — route
      // gating derives onboarding state from the server profile only.)
      logOnboardingEvent("onboarding_completed", {
        chose_starting_action: !!action,
        starting_action_type: action?.entity_type ?? null,
      });
      setSaving(false);
      navigate(action?.route ?? "/", { replace: true });
    } catch (e) {
      setSaving(false);
      toast.error("Almost there — we couldn't finalize your profile.", {
        description: memberSafeMessage(e),
      });
    }
  }

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      {showBack && (
        <header className="safe-top sticky top-0 z-30 bg-background/85 backdrop-blur-md">
          <div className="flex items-center justify-between px-5 pt-3 pb-2 min-h-[3.5rem]">
            <BackButton onClick={() => { goBack(); }} />
            {showProgress ? (
              <span className="text-xs font-medium text-charcoal-muted tabular-nums">
                Step {progressIndex + 1} of {ONBOARDING_PROGRESS_STEPS.length}
              </span>
            ) : (
              <span />
            )}
            <div className="w-9" />
          </div>
          {showProgress && (
            <div className="px-5 pb-3">
              <ProgressBar
                total={ONBOARDING_PROGRESS_STEPS.length}
                current={progressIndex + 1}
              />
            </div>
          )}
        </header>
      )}

      <div className="flex-1 flex flex-col">
        {step === "welcome" && (
          <Welcome
            onGetStarted={() => {
              setAuthIntent("signup");
              setStep("auth");
            }}
            onSignIn={() => {
              setAuthIntent("signin");
              setStep("auth");
            }}
          />
        )}
        {step === "auth" && (
          <Auth
            intent={authIntent}
            nextPath={nextPath}
            onContinue={() => setStep("identity")}
          />
        )}
        {step === "identity" && (
          <Identity
            displayName={displayName}
            setDisplayName={setDisplayName}
            pronouns={pronouns}
            setPronouns={setPronouns}
            onContinue={handleIdentityContinue}
          />
        )}
        {step === "dietary" && (
          <Dietary value={dietary} setValue={setDietary} onContinue={handleDietaryContinue} />
        )}
        {step === "home_city" && (
          <HomeCity
            cityId={homeCityId}
            cityName={homeCityName}
            onSelect={(id, name) => {
              setHomeCityId(id);
              setHomeCityName(name);
            }}
            onContinue={handleHomeCityContinue}
          />
        )}
        {step === "selected_city" && (
          <SelectedCity
            cityId={selectedCityId}
            cityName={selectedCityName}
            homeCityId={homeCityId}
            homeCityName={homeCityName}
            onSelect={(id, name) => {
              setSelectedCityId(id);
              setSelectedCityName(name);
            }}
            onContinue={handleSelectedCityContinue}
          />
        )}
        {step === "interests" && (
          <Interests
            selected={interests}
            toggle={(label) =>
              setInterests((s) => {
                if (s.includes(label)) return s.filter((x) => x !== label);
                if (s.length >= MAX_INTERESTS) return s;
                return [...s, label];
              })
            }
            onContinue={handleInterestsContinue}
          />
        )}
        {step === "photo" && (
          <Photo
            avatarUrl={avatarUrl}
            setAvatarUrl={setAvatarUrl}
            displayName={displayName}
            seed={profile?.id ?? displayName}
            bio={bio}
            setBio={setBio}
            onContinue={() => handlePhotoContinue(false)}
            onSkip={() => {
              // WO-143: skipping still leaves the member with a platform avatar.
              const token = platformAvatarTokenForSeed(profile?.id ?? displayName);
              setAvatarUrl(token);
              handlePhotoContinue(true);
            }}

          />
        )}

        {step === "guidelines" && (
          <Guidelines
            accepted={guidelinesAccepted}
            setAccepted={setGuidelinesAccepted}
            onContinue={handleGuidelinesContinue}
          />
        )}
        {step === "safety" && <Safety onContinue={handleSafetyContinue} />}
        {step === "starting_point" && (
          <StartingPoint
            name={displayName}
            onSkip={() => finish()}
            onChoose={(opt) => {
              logOnboardingEvent("onboarding_starting_action_chosen", {
                entity_type: opt.entity_type,
                action_type: opt.action_type,
                reason_code: opt.reason_code,
              });
              finish({
                route: actionRoute(opt),
                label: actionLabel(opt),
                entity_type: opt.entity_type,
                entity_id: opt.entity_id,
              });
            }}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Sub-screens ---------- */

function ProgressBar({ total, current }: { total: number; current: number }) {
  const pct = Math.max(0, Math.min(100, (current / total) * 100));
  return (
    <div className="h-1 w-full rounded-full bg-border overflow-hidden">
      <div
        className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
      />
    </div>
  );
}

function Welcome({
  onGetStarted,
  onSignIn,
}: {
  onGetStarted: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col page-x pb-10 pt-16 animate-fade-in">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        {/* DEF-092A-01: the hero previously rendered a colour emoji (🥗), which
            falls back to a "tofu" outlined box on platforms without an emoji
            font. Use the icon set already shipped with the app so the mark
            renders identically everywhere. */}
        <div className="w-28 h-28 rounded-full bg-soft-green flex items-center justify-center mb-8">
          <Sprout className="w-14 h-14 text-primary" strokeWidth={1.75} aria-hidden />
        </div>

        <h1 className="text-3xl font-semibold text-charcoal tracking-tight leading-tight">
          Meet Veggies near you.
        </h1>
        <p className="mt-4 text-base text-charcoal-muted max-w-[20rem]">
          A calm place to find people, meetups, and veggie-friendly spots — one
          real connection at a time.
        </p>
      </div>
      <div className="space-y-3">
        <PrimaryButton fullWidth onClick={onGetStarted}>
          Get Started
        </PrimaryButton>
        <button
          onClick={onSignIn}
          className="w-full text-center py-3 text-sm font-medium text-charcoal-muted hover:text-charcoal transition"
        >
          I already have an account
        </button>
      </div>
    </div>
  );
}

function Auth({
  intent,
  onContinue,
  nextPath,
}: {
  intent: "signup" | "signin";
  onContinue: () => void;
  nextPath: string | null;
}) {
  const { session } = useAuth();
  const [mode, setMode] = useState<"choose" | "email">("choose");
  const [isSignUp, setIsSignUp] = useState(intent === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Email signup with confirmation enabled returns no session: the member is
  // NOT signed in until they click the link. We must not walk them into the
  // profile steps, where every write would silently no-op.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  // WO-098: password recovery request lives on the same auth surface so the
  // recovery path is always one tap from Sign in (§23).
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);


  useEffect(() => {
    if (session) onContinue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function providerPlaceholder(name: string) {
    toast(`${name} sign-in is coming soon`, {
      description: "Please continue with email for now.",
    });
  }

  async function handleGoogle() {
    setBusy(true);
    // The provider round trip drops our query string, so remember the intended
    // internal destination per-tab. It is re-sanitized when consumed.
    stashPostAuthPath(nextPath);
    const result = await lovable.auth.signInWithOAuth("google", {
      // Must stay a public same-origin URL — never a protected route.
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error(result.error.message ?? "Could not sign in with Google.");
      return;
    }
    if (result.redirected) return;
    logOnboardingEvent("auth_signin_success");
    toast.success("Welcome to VeggieMeet 🌱");
    onContinue();
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    // WO-098 §57: guard against a double activation of the submit control
    // creating two signup/sign-in requests.
    if (busy) return;
    const address = email.trim();
    if (!address || !isPasswordLongEnough(password)) {
      toast.error(
        `Please enter a valid email and a password (${PASSWORD_MIN_LENGTH}+ characters).`,
      );
      return;
    }

    setBusy(true);
    if (isSignUp) {
      logOnboardingEvent("auth_signup_started");
      const { data, error } = await supabase.auth.signUp({
        email: address,
        password,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      setBusy(false);
      if (error) {
        // WO-098 §52: bounded member-safe copy, never the provider message.
        toast.error(mapAuthError(error).message);
        return;
      }
      if (!data.session) {
        // Confirmation required — park here until the session arrives via the
        // auth listener (clicking the link in this tab or another one).
        stashPostAuthPath(nextPath);
        setPendingEmail(address);
        setPassword("");
        return;
      }
      logOnboardingEvent("auth_signup_success");
      toast.success("Welcome to VeggieMeet 🌱");
      onContinue();
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: address,
        password,
      });
      setBusy(false);
      if (error) {
        const mapped = mapAuthError(error);
        // Category only — the attempted email/password never leave the device.
        logOnboardingEvent("auth_signin_failed", { category: mapped.category });
        toast.error(mapped.message);
        return;
      }
      logOnboardingEvent("auth_signin_success");
      toast.success("Welcome back 🌱");
      onContinue();
    }
  }

  async function handleResend() {
    if (!pendingEmail || busy) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(false);
    if (error) {
      toast.error(mapAuthError(error).message);
      return;
    }
    setResent(true);
    toast.success("Confirmation email sent again.");
  }

  /**
   * WO-098 §24 — password recovery request.
   *
   * The response is deliberately identical whether or not the address has an
   * account: nothing here may confirm account existence (§17).
   */
  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) {
      toast.error("Please enter the email you signed up with.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      const mapped = mapAuthError(error);
      // Rate limiting is the only failure worth surfacing distinctly; every
      // other outcome resolves to the same generic sent state below.
      if (mapped.category === "rate_limited" || mapped.category === "offline") {
        toast.error(mapped.message);
        return;
      }
    }
    logOnboardingEvent("auth_password_reset_requested");
    setForgotSent(true);
  }

  if (forgotMode) {
    return (
      <div className="flex-1 flex flex-col page-x pt-8 pb-10 animate-fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
            Reset your password
          </h1>
          <p className="mt-2 text-base text-charcoal-muted">
            {forgotSent
              ? "If that email has a VeggieMeet account, a reset link is on its way. It can take a minute to arrive."
              : "Enter your email and we'll send you a link to choose a new password."}
          </p>
        </div>
        {forgotSent ? (
          <div className="space-y-3">
            <div
              role="status"
              aria-live="polite"
              className="rounded-control border border-border bg-card px-4 py-3 text-sm text-charcoal-muted"
            >
              Check your inbox — and your spam folder, just in case.
            </div>
            <button
              type="button"
              onClick={() => {
                setForgotMode(false);
                setForgotSent(false);
              }}
              className="w-full h-12 rounded-full border border-border bg-card font-semibold text-charcoal hover:bg-muted/40"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-sm font-semibold text-charcoal mb-2"
                >
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <PrimaryButton type="submit" fullWidth disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </PrimaryButton>
            </form>
            <button
              type="button"
              onClick={() => setForgotMode(false)}
              className="mt-6 text-sm text-charcoal-muted hover:text-charcoal self-start"
            >
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    );
  }

  if (pendingEmail) {
    return (
      <div className="flex-1 flex flex-col page-x pt-8 pb-10 animate-fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
            Confirm your email
          </h1>
          <p className="mt-2 text-base text-charcoal-muted break-words">
            We sent a confirmation link to <span className="font-semibold">{pendingEmail}</span>.
            Open it to finish creating your account — you'll come straight back here.
          </p>
        </div>
        <div
          role="status"
          aria-live="polite"
          className="rounded-control border border-border bg-card px-4 py-3 text-sm text-charcoal-muted"
        >
          {resent
            ? "Sent again. It can take a minute to arrive."
            : "Waiting for confirmation. You can keep this tab open."}
        </div>
        <div className="mt-6 space-y-3">
          <PrimaryButton fullWidth disabled={busy} onClick={handleResend}>
            {busy ? "Sending…" : "Resend confirmation email"}
          </PrimaryButton>
          <button
            type="button"
            onClick={() => {
              setPendingEmail(null);
              setResent(false);
            }}
            className="w-full h-12 rounded-full border border-border bg-card font-semibold text-charcoal hover:bg-muted/40"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }


  if (mode === "email") {
    return (
      <div className="flex-1 flex flex-col page-x pt-8 pb-10 animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-base text-charcoal-muted">
            {isSignUp
              ? "Just an email and password — no extra hoops."
              : "Sign in to pick up where you left off."}
          </p>
        </div>
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-charcoal mb-2">Email</label>
            <input aria-label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <PasswordField
            id="auth-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            describedBy={isSignUp ? "password-requirements" : undefined}
            placeholder={isSignUp ? `At least ${PASSWORD_MIN_LENGTH} characters` : undefined}
          />
          {/* WO-098B: signup shows the exact same rules as /reset-password. */}
          {isSignUp && <PasswordRequirements password={password} />}

          {/* DEF-098A-01: recovery entry point sits directly under the password
              field, above the primary action, so members can discover it. It
              reuses the single WO-098 reset flow (forgotMode) — no second
              implementation. */}
          {!isSignUp && (
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => {
                  setForgotSent(false);
                  setForgotMode(true);
                }}
                className="inline-flex min-h-[44px] items-center text-sm font-medium text-charcoal-muted underline underline-offset-4 hover:text-charcoal rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Forgot your password?
              </button>
            </div>
          )}
          {/* DEF-096A-01: the shared button primitive defaults to
              type="button", so clicking this control never submitted the form —
              email signup and sign-in were only reachable via the Enter key. */}
          <PrimaryButton type="submit" fullWidth disabled={busy}>
            {busy ? "Just a moment…" : isSignUp ? "Create account" : "Sign in"}
          </PrimaryButton>
          {/* WO-099 §23/§24: passive acknowledgement, no pre-checked box, no
              dark pattern. It references only what actually exists today: final
              Community Guidelines, plus the Privacy and Terms surfaces (whose
              formal copy is still in preparation and says so). */}
          {isSignUp && <PolicyAcknowledgement />}
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="text-charcoal-muted hover:text-charcoal"
          >
            ← Other options
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp((v) => !v)}
            className="font-semibold text-primary"
          >
            {isSignUp ? "I already have an account" : "Create an account"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col page-x pt-8 pb-10 animate-fade-in">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          Join VeggieMeet
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          One quick step, then you're in.
        </p>
      </div>
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full h-14 rounded-full border border-border bg-card flex items-center justify-center gap-3 text-charcoal font-semibold hover:bg-muted/40 active:scale-[0.99] transition disabled:opacity-60"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <button
          type="button"
          onClick={() => providerPlaceholder("Apple")}
          aria-disabled
          className="w-full h-14 rounded-full border border-border bg-muted/40 flex items-center justify-between px-5 text-charcoal-muted font-semibold cursor-not-allowed"
        >
          <span className="flex items-center gap-3">
            <AppleIcon />
            Continue with Apple
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
            Coming soon
          </span>
        </button>
        <button
          onClick={() => setMode("email")}
          className="w-full h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center gap-3 font-semibold hover:bg-primary/90 active:scale-[0.99] transition shadow-green"
        >
          <Mail className="w-5 h-5" aria-hidden />
          Continue with Email
        </button>
      </div>
      <div className="mt-auto pt-8">
        <PolicyAcknowledgement />
      </div>
    </div>
  );
}

/**
 * WO-099 §23 — concise, passive acknowledgement shown next to the account
 * creation actions. Links open in the same tab so mobile Back returns to
 * signup. Contrast is `text-charcoal-muted` on `background` (AA), not a
 * low-contrast whisper, and there is no checkbox to pre-tick.
 */
function PolicyAcknowledgement() {
  // Stamp the current history entry so browser/gesture Back returns to the auth
  // surface instead of the splash. Nothing member-identifying is written.
  const stampReturn = () => {
    try {
      window.history.replaceState(
        window.history.state,
        "",
        "/onboarding?resume=auth",
      );
    } catch {
      /* non-fatal: Back simply lands on the splash */
    }
  };
  const linkClass =
    "underline underline-offset-2 font-medium text-charcoal hover:text-primary rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  return (
    <p className="text-center text-xs leading-relaxed text-charcoal-muted">
      By creating an account you agree to follow our{" "}
      <Link to="/community-guidelines" onClick={stampReturn} className={linkClass}>
        Community Guidelines
      </Link>
      . See also{" "}
      <Link to="/privacy" onClick={stampReturn} className={linkClass}>
        Privacy
      </Link>{" "}
      and{" "}
      <Link to="/terms" onClick={stampReturn} className={linkClass}>
        Terms
      </Link>
      .
    </p>
  );
}

function Identity({
  displayName,
  setDisplayName,
  pronouns,
  setPronouns,
  onContinue,
}: {
  displayName: string;
  setDisplayName: (s: string) => void;
  pronouns: string;
  setPronouns: (s: string) => void;
  onContinue: () => void;
}) {
  const canContinue = displayName.trim().length > 0;
  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          What should Veggies call you?
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          A first name is enough — this is how you'll show up around the community.
        </p>
      </div>
      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold text-charcoal mb-2">
            Display name
          </label>
          <input aria-label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Ben"
            maxLength={40}
            className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-charcoal mb-2">
            Pronouns <span className="text-charcoal-muted font-normal">(optional)</span>
          </label>
          <input aria-label="Pronouns (optional)"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            placeholder="e.g. she/her"
            maxLength={24}
            className="w-full h-12 rounded-control border border-border bg-card px-4 text-base text-charcoal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <PrimaryButton
        fullWidth
        onClick={onContinue}
        disabled={!canContinue}
        className={cn("mt-6", !canContinue && "opacity-50 cursor-not-allowed")}
      >
        Continue
      </PrimaryButton>
    </div>
  );
}

function Dietary({
  value,
  setValue,
  onContinue,
}: {
  value: DietaryIdentity | null;
  setValue: (v: DietaryIdentity) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          How would you describe yourself?
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          Pick whatever feels closest today. You can change this any time.
        </p>
      </div>
      <div className="space-y-2 flex-1">
        {DIETARY_OPTIONS.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setValue(o.id)}
              aria-pressed={active}
              className={cn(
                "w-full flex items-center gap-3 p-3.5 rounded-card border transition-all text-left",
                active
                  ? "border-primary bg-accent/40 shadow-sm"
                  : "border-border bg-card hover:bg-accent/30",
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-control flex items-center justify-center shrink-0 text-lg",
                  active ? "bg-primary/15" : "bg-muted",
                )}
                aria-hidden
              >
                {o.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-charcoal">{o.label}</div>
                <div className="text-xs text-charcoal-muted truncate">{o.description}</div>
              </div>
              {active && <Check className="w-5 h-5 text-primary" aria-hidden />}
            </button>
          );
        })}
      </div>
      <PrimaryButton
        fullWidth
        onClick={onContinue}
        disabled={!value}
        className={cn("mt-4", !value && "opacity-50 cursor-not-allowed")}
      >
        Continue
      </PrimaryButton>
    </div>
  );
}

function HomeCity({
  cityId,
  cityName,
  onSelect,
  onContinue,
}: {
  cityId: string | null;
  cityName: string | null;
  onSelect: (id: string, name: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          Where do you call home?
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          Your home city grounds the meetups and Veggies we surface first.
        </p>
      </div>
      <div className="flex-1">
        <CitySelector
          variant="block"
          value={cityId}
          triggerLabel={cityName ?? "Choose a city"}
          title="Set your home city"
          onSelect={async (id, name) => onSelect(id, name)}
        />
        <p className="mt-3 text-xs text-charcoal-muted">
          You can explore other cities any time from the top bar.
        </p>
      </div>
      <PrimaryButton
        fullWidth
        onClick={onContinue}
        disabled={!cityId}
        className={cn("mt-4", !cityId && "opacity-50 cursor-not-allowed")}
      >
        Continue
      </PrimaryButton>
    </div>
  );
}

function SelectedCity({
  cityId,
  cityName,
  homeCityId,
  homeCityName,
  onSelect,
  onContinue,
}: {
  cityId: string | null;
  cityName: string | null;
  homeCityId: string | null;
  homeCityName: string | null;
  onSelect: (id: string, name: string) => void;
  onContinue: () => void;
}) {
  const differs = cityId && homeCityId && cityId !== homeCityId;
  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          Where are you exploring today?
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          Your selected city shapes the Meetups, Veggies, and Places you see
          right now. You can switch cities any time — your home stays the same.
        </p>
      </div>
      <div className="flex-1">
        <CitySelector
          variant="block"
          value={cityId}
          triggerLabel={cityName ?? homeCityName ?? "Choose a city"}
          title="Set your selected city"
          onSelect={async (id, name) => onSelect(id, name)}
        />
        <p className="mt-3 text-xs text-charcoal-muted">
          {differs
            ? `Exploring ${cityName}. Home stays ${homeCityName}.`
            : `Defaults to your home city (${homeCityName ?? "—"}).`}
        </p>
      </div>
      <PrimaryButton
        fullWidth
        onClick={onContinue}
        disabled={!cityId}
        className={cn("mt-4", !cityId && "opacity-50 cursor-not-allowed")}
      >
        Continue
      </PrimaryButton>
    </div>
  );
}


function Interests({
  selected,
  toggle,
  onContinue,
}: {
  selected: string[];
  toggle: (label: string) => void;
  onContinue: () => void;
}) {
  const [options, setOptions] = useState<InterestOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchInterestCatalogue()
      .then((rows) => setOptions(rows))
      .catch(() => setOptions([]))
      .finally(() => setLoaded(true));
  }, []);

  const canContinue = selected.length >= MIN_INTERESTS && selected.length <= MAX_INTERESTS;

  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          What are you into?
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          Pick {MIN_INTERESTS}–{MAX_INTERESTS} — we'll use these to suggest people and meetups.
        </p>
      </div>
      <div className="flex-1">
        <InterestPicker
          options={options}
          loading={!loaded}
          selected={selected}
          onToggle={toggle}
          min={MIN_INTERESTS}
          max={MAX_INTERESTS}
        />
      </div>
      <PrimaryButton
        fullWidth
        onClick={onContinue}
        disabled={!canContinue}
        className={cn("mt-3", !canContinue && "opacity-50 cursor-not-allowed")}
      >
        Continue
      </PrimaryButton>
    </div>
  );

}

function Photo({
  avatarUrl,
  setAvatarUrl,
  displayName,
  seed,
  bio,
  setBio,
  onContinue,
  onSkip,
}: {
  avatarUrl: string | null;
  setAvatarUrl: (u: string | null) => void;
  displayName: string;
  /** WO-143 QA: stable seed (profile id) so the client-side platform token
   *  matches the token the server derives for the same member. */
  seed: string;
  bio: string;
  setBio: (s: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);


  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { uploadAvatar } = await import("@/lib/imageUpload");
      const url = await uploadAvatar(file);
      setAvatarUrl(url);
      setSheetOpen(false);
    } catch (err) {
      toast.error(memberSafeMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          Put a friendly face to your name
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          A photo and a line about you help people say hi. Totally optional.
        </p>
      </div>

      <div className="flex flex-col items-center mb-6">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Change profile photo"
          className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition"
        >
          <UserAvatar
            name={displayName || "You"}
            src={avatarUrl ?? undefined}
            size="xl"
          />
          <span className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-green">
            <Camera className="w-4 h-4" aria-hidden />
          </span>
        </button>
      </div>

      <div className="space-y-2 flex-1">
        <label className="block text-sm font-semibold text-charcoal">
          Short bio <span className="text-charcoal-muted font-normal">(optional)</span>
        </label>
        <textarea
          aria-label="Short bio (optional)"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="One friendly line about you."
          rows={3}
          maxLength={160}
          className="w-full rounded-control border border-border bg-card px-4 py-3 text-base text-charcoal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
        <p className="text-xs text-charcoal-muted text-right">{bio.length}/160</p>
      </div>

      <div className="mt-4 space-y-2">
        <PrimaryButton fullWidth onClick={onContinue}>
          Continue
        </PrimaryButton>
        <button
          type="button"
          onClick={onSkip}
          className="w-full text-center py-3 text-sm font-medium text-charcoal-muted hover:text-charcoal transition"
        >
          Skip for now
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-t border-border p-0"
        >
          <SheetHeader className="page-x pt-6 pb-2 text-left">
            <SheetTitle className="text-lg font-semibold text-charcoal">
              Profile photo
            </SheetTitle>
            <SheetDescription className="text-sm text-charcoal-muted">
              You can always change this later.
            </SheetDescription>
          </SheetHeader>
          <div className="page-x pb-6 pt-3 space-y-1">
            {pickerOpen ? (
              <div>
                <p className="text-sm font-semibold text-charcoal mb-3">
                  Pick a VeggieMeet avatar
                </p>
                <div className="grid grid-cols-4 gap-3">
                  {PLATFORM_AVATARS.map((asset, i) => {
                    const token = platformAvatarToken(i + 1);
                    const selected = avatarUrl === token;
                    return (
                      <button
                        key={token}
                        type="button"
                        aria-label={`VeggieMeet avatar ${i + 1}`}
                        aria-pressed={selected}
                        onClick={() => {
                          setAvatarUrl(token);
                          setPickerOpen(false);
                          setSheetOpen(false);
                        }}
                        className={`rounded-full overflow-hidden aspect-square transition ${
                          selected
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                            : "ring-1 ring-border hover:ring-primary/60"
                        }`}
                      >
                        <img
                          src={asset}
                          alt=""
                          loading="lazy"
                          width={512}
                          height={512}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="w-full mt-4 h-12 rounded-card bg-muted text-charcoal font-semibold hover:bg-muted/80 transition"
                >
                  Back
                </button>
              </div>
            ) : (
              <>
                <SheetAction
                  icon={<Shuffle className="w-5 h-5" />}
                  label="Choose a VeggieMeet avatar"
                  onClick={() => setPickerOpen(true)}
                />
                <SheetAction
                  icon={<ImagePlus className="w-5 h-5" />}
                  label={uploading ? "Uploading…" : "Upload photo"}
                  hint="JPG, PNG or WebP, up to 5 MB"
                  onClick={() => fileRef.current?.click()}
                />
                {avatarUrl && !isPlatformAvatarToken(avatarUrl) && (
                  <SheetAction
                    icon={<Trash2 className="w-5 h-5" />}
                    label="Remove photo"
                    hint="Uses your VeggieMeet avatar instead"
                    destructive
                    onClick={() => {
                      setAvatarUrl(platformAvatarTokenForSeed(seed));
                      setSheetOpen(false);
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="w-full mt-2 h-12 rounded-card bg-muted text-charcoal font-semibold hover:bg-muted/80 transition"
                >
                  Cancel
                </button>
              </>
            )}
          </div>

        </SheetContent>
      </Sheet>
    </div>
  );
}

function SheetAction({
  icon,
  label,
  hint,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3.5 rounded-card hover:bg-accent/40 active:scale-[0.99] transition text-left",
        destructive ? "text-destructive" : "text-charcoal",
      )}
    >
      <span
        className={cn(
          "w-10 h-10 rounded-control flex items-center justify-center shrink-0",
          destructive ? "bg-destructive/10" : "bg-muted",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 font-semibold">{label}</span>
      {hint && <span className="text-xs text-charcoal-muted">{hint}</span>}
    </button>
  );
}

function Guidelines({
  accepted,
  setAccepted,
  onContinue,
}: {
  accepted: boolean;
  setAccepted: (v: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <div className="w-14 h-14 rounded-card bg-primary/10 flex items-center justify-center mb-4">
          <Heart className="w-6 h-6 text-primary" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          Our community promise
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          VeggieMeet works because everyone shows up with care.
        </p>
      </div>

      <ul className="space-y-3 flex-1">
        <GuidelineItem title="Be kind" body="Treat every Veggie the way you'd like to be met — with warmth and respect." />
        <GuidelineItem title="Show up" body="If plans change, cancel early so hosts and other guests know." />
        <GuidelineItem title="Support the community" body="Check in at meetups and places that welcome us. Small actions add up." />
        <GuidelineItem title="Speak up safely" body="If something feels off, use Report or Block. We take every signal seriously." />
      </ul>

      {/* WO-099: the full Community Guidelines are one tap away, same tab. */}
      <Link
        to="/community-guidelines"
        className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-charcoal underline underline-offset-4 hover:text-primary"
      >
        Read the full Community Guidelines
      </Link>

      <label className="mt-4 flex items-start gap-3 rounded-card border border-border bg-card p-3.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 w-5 h-5 rounded border-border accent-primary"
        />
        <span className="text-sm text-charcoal">
          I'll keep VeggieMeet a warm and respectful space.
        </span>
      </label>

      <PrimaryButton
        fullWidth
        onClick={onContinue}
        disabled={!accepted}
        className={cn("mt-4", !accepted && "opacity-50 cursor-not-allowed")}
      >
        I agree
      </PrimaryButton>
    </div>
  );
}

function GuidelineItem({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 w-6 h-6 rounded-full bg-soft-green text-primary flex items-center justify-center shrink-0">
        <Check className="w-4 h-4" aria-hidden />
      </span>
      <div>
        <div className="font-semibold text-charcoal">{title}</div>
        <div className="text-sm text-charcoal-muted">{body}</div>
      </div>
    </li>
  );
}

function Safety({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <div className="w-14 h-14 rounded-card bg-primary/10 flex items-center justify-center mb-4">
          <Shield className="w-6 h-6 text-primary" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          You're in control
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          A quick tour of the tools that keep meetups feeling safe.
        </p>
      </div>

      <ul className="space-y-3 flex-1">
        <SafetyItem
          icon={<Users className="w-5 h-5" aria-hidden />}
          title="Meet in public"
          body="Every meetup happens at a known place. Coordinates only unlock once you've joined."
        />
        <SafetyItem
          icon={<Utensils className="w-5 h-5" aria-hidden />}
          title="Verified connections"
          body="Real-life check-ins turn casual meetups into verified friendships — slowly, on your terms."
        />
        <SafetyItem
          icon={<Shield className="w-5 h-5" aria-hidden />}
          title="Block and report, any time"
          body="One tap from any profile or meetup. Blocked people never see you again."
        />
      </ul>

      <PrimaryButton fullWidth onClick={onContinue} className="mt-4">
        Got it
      </PrimaryButton>
    </div>
  );
}

function SafetyItem({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3 rounded-card border border-border bg-card p-3.5">
      <span className="w-10 h-10 rounded-control bg-soft-green text-primary flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div>
        <div className="font-semibold text-charcoal">{title}</div>
        <div className="text-sm text-charcoal-muted">{body}</div>
      </div>
    </li>
  );
}

function StartingPoint({
  name,
  onSkip,
  onChoose,
  saving,
}: {
  name: string;
  onSkip: () => void;
  onChoose: (opt: StartingPointOption) => void;
  saving: boolean;
}) {
  const [options, setOptions] = useState<StartingOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStartingOptions()
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(memberSafeMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const list: StartingPointOption[] = useMemo(() => {
    if (!options) return [];
    return [options.veggie, options.meetup, options.place].filter(
      (x): x is StartingPointOption => !!x,
    );
  }, [options]);

  const firstName = name.trim().split(/\s+/)[0] || "";

  return (
    <div className="flex-1 flex flex-col page-x pt-4 pb-8 animate-fade-in">
      <div className="mb-6">
        <div className="w-14 h-14 rounded-card bg-primary/10 flex items-center justify-center mb-4">
          <Sparkles className="w-6 h-6 text-primary" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          {firstName ? `You're set, ${firstName}.` : "You're all set."}
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          One small action makes VeggieMeet feel real. Pick something that catches your eye.
        </p>
      </div>

      <div className="flex-1 space-y-3">
        {loading && (
          <>
            <StartingSkeleton />
            <StartingSkeleton />
            <StartingSkeleton />
          </>
        )}
        {!loading && error && (
          <div className="rounded-card border border-border bg-card p-4 text-sm text-charcoal-muted">
            We couldn't load suggestions right now — you can explore from the home screen instead.
          </div>
        )}
        {!loading && !error && list.length === 0 && (
          <div className="rounded-card border border-border bg-card p-4 text-sm text-charcoal-muted">
            No suggestions yet in your city. Jump into the community to explore what's nearby.
          </div>
        )}
        {!loading &&
          list.map((opt) => (
            <StartingCard key={`${opt.entity_type}-${opt.entity_id}`} option={opt} onChoose={onChoose} disabled={saving} />
          ))}
      </div>

      <div className="mt-4 space-y-2">
        <PrimaryButton fullWidth onClick={onSkip} disabled={saving}>
          {saving ? "Just a moment…" : "Take me home"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function StartingSkeleton() {
  return (
    <div className="rounded-card border border-border bg-card p-3.5 flex items-center gap-3 animate-pulse">
      <div className="w-14 h-14 rounded-control bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-2/3 bg-muted rounded" />
        <div className="h-3 w-1/2 bg-muted rounded" />
      </div>
    </div>
  );
}

function StartingCard({
  option,
  onChoose,
  disabled,
}: {
  option: StartingPointOption;
  onChoose: (o: StartingPointOption) => void;
  disabled: boolean;
}) {
  const typeLabel =
    option.entity_type === "veggie"
      ? "Veggie"
      : option.entity_type === "meetup"
        ? "Meetup"
        : "Place";
  const Icon =
    option.entity_type === "veggie" ? Users : option.entity_type === "meetup" ? Sparkles : MapPin;

  return (
    <button
      type="button"
      onClick={() => onChoose(option)}
      disabled={disabled}
      className="w-full text-left rounded-card border border-border bg-card p-3.5 flex items-center gap-3 hover:bg-accent/30 active:scale-[0.99] transition disabled:opacity-60"
    >
      <div className="w-14 h-14 rounded-control bg-muted overflow-hidden shrink-0 flex items-center justify-center">
        {option.image ? (
          <img src={option.image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <Icon className="w-5 h-5 text-charcoal-muted" aria-hidden />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-charcoal-muted font-semibold">
          {typeLabel} · {option.reason_label}
        </div>
        <div className="font-semibold text-charcoal truncate">{option.title}</div>
        {option.city && (
          <div className="text-xs text-charcoal-muted truncate">{option.city}</div>
        )}
      </div>
      <span className="text-sm font-semibold text-primary shrink-0">
        {actionLabel(option)}
      </span>
    </button>
  );
}

/* ---------- Icons ---------- */

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.8 6.5 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.3-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.8 6.5 29.1 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5 0 9.6-1.9 13.1-5l-6.1-5c-2 1.5-4.5 2.5-7 2.5-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.1 5c3.5-3.2 6.1-8 6.1-14.5 0-1.2-.1-2.3-.3-3.5z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.22-1.24 3.02-.83.8-2.16 1.42-3.19 1.33-.13-1.1.41-2.24 1.19-3.02.87-.87 2.3-1.5 3.24-1.33zM20.5 17.2c-.56 1.3-.83 1.88-1.55 3.02-1 1.6-2.42 3.6-4.18 3.62-1.56.01-1.96-1.02-4.08-1.01-2.12.01-2.56 1.02-4.12 1.01-1.76-.02-3.1-1.82-4.1-3.42C.15 17.42-.36 12.9 1.6 10.24c1.15-1.57 2.97-2.56 4.7-2.56 1.76 0 2.86 1 4.3 1 1.4 0 2.26-1 4.3-1 1.54 0 3.16.84 4.3 2.3-3.78 2.07-3.16 7.47.9 7.22z" />
    </svg>
  );
}
