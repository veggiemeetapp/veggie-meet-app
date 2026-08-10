import { safeBack } from "@/lib/navigation";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { PrimaryButton, SecondaryButton, Card, UserAvatar, BackButton } from "@/components/app";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
// WO-086 DEF-086-01: the camera decoder (html5-qrcode) is ~330 kB minified and
// was pulled into the CheckIn route chunk even for members who only ever show
// their own QR. It now loads on demand, the first time Scan mode opens.
const QRScanner = lazy(() =>
  import("@/components/scan/QRScanner").then((m) => ({ default: m.QRScanner })),
);
import { useAuth } from "@/hooks/useAuth";
import { fetchMeetupById, fetchProfileAsVeggie, isUuid } from "@/lib/backend";
import {
  encodeVerifyPayload,
  issueMeetupQrToken,
  verifyMeetupConnection,
  type IssuedToken,
  type VerifyResult,
} from "@/lib/meetupCheckin";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Meetup, Veggie } from "@/types";
import { toast } from "sonner";

type Mode = "hub" | "qr" | "scan";

export default function CheckIn() {
  const { meetupId = "" } = useParams();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("hub");
  const [meetup, setMeetup] = useState<Meetup | null | undefined>(undefined);
  const [success, setSuccess] = useState<{ kind: "verified" | "already"; peer: Veggie | null } | null>(
    null,
  );

  const realMeetup = isUuid(meetupId);

  useEffect(() => {
    if (!realMeetup) {
      setMeetup(null);
      return;
    }
    fetchMeetupById(meetupId).then(setMeetup);
  }, [meetupId, realMeetup]);

  // Realtime: if this user's QR gets scanned while they're on this screen,
  // surface the same success dialog without any interaction.
  useEffect(() => {
    if (!realMeetup || !profile?.id) return;
    const channel = supabase
      .channel(`verified-conn:${meetupId}:${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "verified_meetup_connections",
          filter: `meetup_id=eq.${meetupId}`,
        },
        async (payload) => {
          const row = payload.new as { profile_a_id: string; profile_b_id: string; scanned_by: string };
          const involvesMe = row.profile_a_id === profile.id || row.profile_b_id === profile.id;
          if (!involvesMe) return;
          if (row.scanned_by === profile.id) return; // already handled locally
          const peerId = row.profile_a_id === profile.id ? row.profile_b_id : row.profile_a_id;
          const peer = await fetchProfileAsVeggie(peerId);
          setSuccess({ kind: "verified", peer });
          qc.invalidateQueries({ queryKey: ["community-impact"] });
          qc.invalidateQueries({ queryKey: ["relationships"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetupId, realMeetup, profile?.id, qc]);

  async function handleScanResult(raw: string) {
    const result: VerifyResult = await verifyMeetupConnection(raw);
    if (result.kind === "error") {
      toast.error(errorCopy(result.code, result.message));
      // Stay on scan for retryable errors; go back to hub for terminal ones.
      if (result.code === "expired" || result.code === "invalid") setMode("scan");
      else setMode("hub");
      return;
    }
    const peer = await fetchProfileAsVeggie(result.peerId);
    setSuccess({ kind: result.kind === "verified" ? "verified" : "already", peer });
    setMode("hub");
    // Refresh downstream state.
    qc.invalidateQueries({ queryKey: ["meetup-membership", meetupId] });
    qc.invalidateQueries({ queryKey: ["community-impact"] });
    qc.invalidateQueries({ queryKey: ["relationships"] });
  }

  if (authLoading || meetup === undefined) {
    return (
      <div className="flex flex-col min-h-dvh items-center justify-center text-sm text-charcoal-muted">
        Loading…
      </div>
    );
  }

  if (!meetup) {
    return (
      <div className="flex flex-col min-h-dvh">
        <Header onBack={() => safeBack(navigate, "/plans")} title="Meet Veggies" />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">This Meetup isn't available.</p>
          <button onClick={() => navigate("/")} className="mt-4 text-sm font-semibold text-primary">
            Back to Today
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh">
      <Header
        onBack={() => (mode === "hub" ? safeBack(navigate, "/plans") : setMode("hub"))}
        title={mode === "qr" ? "Your Meetup QR" : mode === "scan" ? "Scan a Veggie" : "Meet Veggies"}
      />

      {mode === "hub" && (
        <HubView meetup={meetup} onShowQR={() => setMode("qr")} onScan={() => setMode("scan")} />
      )}

      {mode === "qr" && profile && (
        <QRView meetupId={meetup.id} displayName={profile.display_name} avatarUrl={profile.avatar_url ?? undefined} meetupTitle={meetup.title} />
      )}

      {mode === "scan" && (
        <Suspense
          fallback={
            <p className="px-5 py-8 text-sm text-charcoal-muted" role="status">
              Starting your camera…
            </p>
          }
        >
          <QRScanner
            onResult={handleScanResult}
            helpText="Point your camera at their Meetup QR code."
            fallbackAction={{ label: "Show my QR", onClick: () => setMode("qr") }}
          />
        </Suspense>
      )}

      <Dialog open={!!success} onOpenChange={(open) => !open && setSuccess(null)}>
        <DialogContent className="rounded-3xl border-0 sm:max-w-sm animate-in fade-in-0 zoom-in-95 duration-200">
          <DialogHeader>
            <div className="mx-auto mb-2 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <DialogTitle className="text-center text-xl">
              {success?.kind === "verified" ? "You met in real life!" : "You're already Verified Connections"}
            </DialogTitle>
            <DialogDescription className="text-center">
              {success?.kind === "verified"
                ? `You and ${success.peer?.displayName ?? "your fellow Veggie"} are now Verified Connections.`
                : "This Meetup check-in was confirmed."}
            </DialogDescription>
          </DialogHeader>
          {success?.peer && (
            <div className="flex flex-col items-center gap-2 py-2">
              <UserAvatar name={success.peer.displayName} src={success.peer.avatarUrl} size="xl" />
              <p className="text-xs text-charcoal-muted">{meetup.title}</p>
            </div>
          )}
          <div className="pt-2 flex flex-col gap-2">
            {success?.peer && (
              <SecondaryButton fullWidth onClick={() => navigate(`/veggie/${success.peer!.id}`)}>
                View profile
              </SecondaryButton>
            )}
            <PrimaryButton fullWidth onClick={() => setSuccess(null)}>
              Done
            </PrimaryButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="safe-top flex items-center gap-2 page-x pt-3 pb-2">
      <BackButton onClick={() => { onBack(); }} />
      <h1 className="text-base font-semibold text-charcoal">{title}</h1>
    </div>
  );
}

function HubView({ meetup, onShowQR, onScan }: { meetup: Meetup; onShowQR: () => void; onScan: () => void }) {
  return (
    <div className="flex-1 px-5 pt-2 pb-10 space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-charcoal-muted">{meetup.title}</p>
        <h2 className="text-2xl font-semibold text-charcoal leading-tight">Meet Veggies</h2>
        <p className="text-sm text-charcoal-muted leading-relaxed">
          Scan each other's Meetup QR codes to confirm you met in person. You need to be connected first — this doesn't
          create new connections.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Card interactive onClick={onScan} className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <ScanLine className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-charcoal">Scan a QR</p>
            <p className="text-xs text-charcoal-muted">Use your camera</p>
          </div>
        </Card>
        <Card interactive onClick={onShowQR} className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center text-charcoal">
            <QrCode className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-charcoal">Show my QR</p>
            <p className="text-xs text-charcoal-muted">Let them scan you</p>
          </div>
        </Card>
      </div>

      <Card className="bg-muted/60 border-border/60">
        <p className="text-xs text-charcoal-muted leading-relaxed">
          Verification requires both people to already be connected on VeggieMeet and to be attending this Meetup.
          QR codes are short-lived and only work for this Meetup.
        </p>
      </Card>
    </div>
  );
}

function QRView({
  meetupId,
  displayName,
  avatarUrl,
  meetupTitle,
}: {
  meetupId: string;
  displayName: string;
  avatarUrl?: string;
  meetupTitle: string;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "expired" | "error"; token?: IssuedToken; error?: string }>(
    { status: "loading" },
  );
  const timerRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function issue() {
    setState({ status: "loading" });
    try {
      const token = await issueMeetupQrToken(meetupId);
      setState({ status: "ready", token });
    } catch (e: any) {
      setState({ status: "error", error: e?.message ?? "Couldn't generate code" });
    }
  }

  useEffect(() => {
    issue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetupId]);

  useEffect(() => {
    if (state.status !== "ready" || !state.token) return;
    const tick = () => {
      setNow(Date.now());
      const exp = new Date(state.token!.expiresAt).getTime();
      if (Date.now() >= exp) {
        setState((s) => ({ ...s, status: "expired" }));
        if (timerRef.current) window.clearInterval(timerRef.current);
      }
    };
    timerRef.current = window.setInterval(tick, 1000) as unknown as number;
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [state.status, state.token]);

  const secondsLeft = useMemo(() => {
    if (state.status !== "ready" || !state.token) return 0;
    return Math.max(0, Math.floor((new Date(state.token.expiresAt).getTime() - now) / 1000));
  }, [state, now]);

  return (
    <div className="flex-1 flex flex-col items-center page-x pt-4 pb-10 gap-5">
      <p className="text-sm text-charcoal-muted text-center max-w-xs">
        Have a connected attendee scan this code. It expires quickly for your safety.
      </p>
      <div className="bg-white p-6 rounded-3xl shadow-card relative">
        {state.status === "ready" && state.token ? (
          <QRCodeSVG value={encodeVerifyPayload(state.token.token)} size={240} level="M" includeMargin={false} />
        ) : (
          <div
            className="w-[240px] h-[240px] flex items-center justify-center text-sm text-charcoal-muted"
            aria-live="polite"
          >
            {state.status === "loading" && "Generating code…"}
            {state.status === "expired" && "This QR has expired"}
            {state.status === "error" && (state.error ?? "Couldn't generate code")}
          </div>
        )}
        {state.status === "expired" && (
          <div className="absolute inset-0 rounded-3xl bg-white/70 flex items-center justify-center">
            <p className="text-sm font-semibold text-charcoal">Expired</p>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <UserAvatar name={displayName} src={avatarUrl} size="md" />
          <p className="text-base font-semibold text-charcoal">{displayName}</p>
        </div>
        <p className="text-xs text-charcoal-muted">{meetupTitle}</p>
      </div>
      {state.status === "ready" && (
        <p className="text-xs text-charcoal-muted" aria-live="polite">
          Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </p>
      )}
      {(state.status === "expired" || state.status === "error") && (
        <PrimaryButton onClick={issue}>
          <RefreshCw className="w-4 h-4" /> Refresh QR
        </PrimaryButton>
      )}
    </div>
  );
}

function errorCopy(code: string, fallback: string) {
  switch (code) {
    case "self":
      return "You can't scan your own QR code.";
    case "expired":
      return "This QR has expired. Ask them to refresh it.";
    case "invalid":
      return "That isn't a valid VeggieMeet check-in code.";
    case "not_attendee":
      return "Both people must be confirmed attendees of this Meetup.";
    case "not_connected":
      return "You need to be connected before verifying that you met.";
    case "cancelled":
      return "This Meetup was cancelled.";
    case "too_early":
      return "Check-in opens closer to the Meetup.";
    case "closed":
      return "Check-in for this Meetup has ended.";
    case "blocked":
      return "Verification isn't available for this pair.";
    default:
      return fallback || "Something went wrong. Try again.";
  }
}
