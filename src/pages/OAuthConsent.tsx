import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton } from "@/components/app";

// Minimal typed wrapper for the beta supabase.auth.oauth namespace.
type AuthorizationDetails = {
  client?: { name?: string; client_name?: string; redirect_uris?: string[] } | null;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
};
type OauthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};
const oauthApi = () =>
  (supabase.auth as unknown as { oauth: OauthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization request.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/onboarding?next=" + encodeURIComponent(next);
        return;
      }
      setEmail(sess.session.user.email ?? null);
      const { data, error: e } = await oauthApi().getAuthorizationDetails(
        authorizationId,
      );
      if (!active) return;
      if (e) {
        setError(e.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const api = oauthApi();
    const { data, error: e } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6 bg-background">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="text-xl font-semibold text-charcoal">
            Could not load this authorization
          </h1>
          <p className="mt-2 text-sm text-charcoal-muted">{error}</p>
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6 bg-background">
        <p className="text-sm text-charcoal-muted">Loading…</p>
      </main>
    );
  }

  const clientName =
    details.client?.client_name ?? details.client?.name ?? "an app";
  const scopes = (details.scope ?? "").split(/\s+/).filter(Boolean);

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-10 bg-background">
      <div className="max-w-sm w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-3xl bg-soft-green flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🌱</span>
          </div>
          <h1 className="text-xl font-semibold text-charcoal tracking-tight">
            Connect {clientName} to VeggieMeet
          </h1>
          <p className="mt-2 text-sm text-charcoal-muted">
            This lets {clientName} use VeggieMeet as you.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3 mb-6">
          {email && (
            <div className="text-sm">
              <div className="text-charcoal-muted">Signed in as</div>
              <div className="font-medium text-charcoal">{email}</div>
            </div>
          )}
          <div className="text-sm">
            <div className="text-charcoal-muted mb-1">Access granted</div>
            <ul className="text-charcoal space-y-1">
              <li>• Read your VeggieMeet profile and meetups</li>
              <li>• Join meetups on your behalf (with your confirmation)</li>
              <li>• See your Veggie Network</li>
            </ul>
          </div>
          {scopes.length > 0 && (
            <div className="text-xs text-charcoal-muted">
              Identity scopes: {scopes.join(", ")}
            </div>
          )}
          <div className="text-xs text-charcoal-muted">
            This does not bypass VeggieMeet's permissions.
          </div>
        </div>

        <div className="space-y-3">
          <PrimaryButton
            fullWidth
            onClick={() => decide(true)}
            disabled={busy}
          >
            {busy ? "Just a moment…" : "Approve"}
          </PrimaryButton>
          <button
            onClick={() => decide(false)}
            disabled={busy}
            className="w-full text-center py-3 text-sm font-medium text-charcoal-muted hover:text-charcoal transition"
          >
            Cancel connection
          </button>
        </div>
      </div>
    </main>
  );
}
