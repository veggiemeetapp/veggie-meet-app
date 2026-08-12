import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton } from "@/components/app";
import { PasswordRequirements } from "@/components/auth/PasswordRequirements";
import { PasswordField } from "@/components/auth/PasswordField";
import {
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  isPasswordLongEnough,
} from "@/lib/passwordPolicy";
import { mapAuthError } from "@/lib/authErrors";
import { logAnalyticsEvent } from "@/lib/analytics";


/**
 * WO-098 — dedicated password reset destination.
 *
 * The recovery email links here. Supabase exchanges the token in the URL for a
 * short recovery session, so this screen must be public (no onboarding guard)
 * and must render nothing but the password form until the new password is set.
 *
 * Security notes:
 * - The token never appears in the UI, and the URL is scrubbed as soon as the
 *   recovery session is detected so it cannot be screenshotted, copied out of
 *   the address bar, or captured by telemetry.
 * - After a successful change the recovery session is signed out, so the member
 *   must authenticate with the new password. That keeps a recovery link from
 *   leaving behind a long-lived authenticated session.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "valid" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;

    function scrubUrl() {
      // Drop the token-bearing hash/query without a navigation.
      window.history.replaceState({}, "", "/reset-password");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        scrubUrl();
        setReady("valid");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        scrubUrl();
        setReady("valid");
      } else {
        // No recovery session could be established from the link.
        setReady((prev) => (prev === "valid" ? prev : "invalid"));
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!isPasswordLongEnough(password)) {
      setError(PASSWORD_TOO_SHORT_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    setBusy(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      const mapped = mapAuthError(updateError);
      setBusy(false);
      setError(mapped.message);
      // Category only — never the attempted password or the raw provider text.
      logAnalyticsEvent("auth_password_reset_failed", { category: mapped.category });
      return;
    }
    logAnalyticsEvent("auth_password_reset_success");
    setDone(true);
    setBusy(false);
    // End the recovery session so the new password is actually exercised.
    await supabase.auth.signOut();
    toast.success("Password updated. Please sign in.");
  }

  if (ready === "checking") {
    return (
      <div className="min-h-dvh flex items-center justify-center page-x bg-background">
        <p className="text-sm text-charcoal-muted">Checking your link…</p>
      </div>
    );
  }

  if (ready === "invalid") {
    return (
      <div className="min-h-dvh flex flex-col justify-center page-x py-10 bg-background">
        <div className="w-full max-w-sm mx-auto">
          <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
            This reset link has expired
          </h1>
          <p className="mt-2 text-base text-charcoal-muted">
            Password reset links can only be used once, and they expire after a while.
            Request a fresh one and we'll email it straight over.
          </p>
          <div className="mt-6">
            <PrimaryButton fullWidth onClick={() => navigate("/onboarding")}>
              Request a new link
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-dvh flex flex-col justify-center page-x py-10 bg-background">
        <div className="w-full max-w-sm mx-auto">
          <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
            Password updated
          </h1>
          <p className="mt-2 text-base text-charcoal-muted">
            Your new password is ready. Sign in to get back to VeggieMeet.
          </p>
          <div className="mt-6">
            <PrimaryButton fullWidth onClick={() => navigate("/onboarding")}>
              Sign in
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col justify-center page-x py-10 bg-background">
      <div className="w-full max-w-sm mx-auto">
        <h1 className="text-2xl font-semibold text-charcoal tracking-tight">
          Choose a new password
        </h1>
        <p className="mt-2 text-base text-charcoal-muted">
          Pick something you haven't used elsewhere.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <PasswordField
            id="new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            invalid={Boolean(error)}
            describedBy={
              error ? "reset-error password-requirements" : "password-requirements"
            }
          />
          {/* WO-098B: the real, backend-enforced rules — shown before submit. */}
          <PasswordRequirements password={password} />
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={Boolean(error)}
            describedBy={error ? "reset-error" : undefined}
          />
          {error && (
            <p id="reset-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <PrimaryButton type="submit" fullWidth disabled={busy}>
            {busy ? "Saving…" : "Save new password"}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}

