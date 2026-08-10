import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, MessageSquareHeart } from "lucide-react";
import { AppHeader, Card, PrimaryButton, BackButton } from "@/components/app";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { safeBack } from "@/lib/navigation";
import { logAnalyticsEvent, routeTemplate } from "@/lib/analytics";
import { showErrorToast } from "@/lib/errorToast";
import { useSendToken } from "@/hooks/useSendToken";
import { APP_VERSION } from "@/lib/appVersion";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  FEEDBACK_SURFACES,
  submitBetaFeedback,
  type FeedbackCategory,
  type FeedbackSurface,
} from "@/lib/betaFeedback";

/**
 * WO-089 — member beta feedback.
 *
 * Deliberately NOT a safety channel: the screen states plainly that anything
 * involving safety, harassment or a person belongs in the Safety & Trust
 * Center, and links there. One canonical submission path, one confirmation,
 * idempotent against double taps.
 */
export default function BetaFeedback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { tokenFor, clear } = useSendToken();

  const initialSurface = useMemo<FeedbackSurface>(() => {
    const s = params.get("surface");
    return FEEDBACK_SURFACES.some((x) => x.id === s)
      ? (s as FeedbackSurface)
      : "other";
  }, [params]);

  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [surface, setSurface] = useState<FeedbackSurface>(initialSurface);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    logAnalyticsEvent("beta_feedback_opened", { surface: initialSurface });
  }, [initialSurface]);

  const trimmed = message.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < FEEDBACK_MIN;
  const canSend = trimmed.length >= FEEDBACK_MIN && trimmed.length <= FEEDBACK_MAX;

  const send = useMutation({
    mutationFn: () =>
      submitBetaFeedback({
        category,
        surface,
        message: trimmed,
        routeTemplate: routeTemplate("/settings/feedback"),
        clientToken: tokenFor(trimmed),
      }),
    onSuccess: () => {
      clear();
      setSent(true);
      logAnalyticsEvent("beta_feedback_submitted", { category, surface });
      toast.success("Thanks — your note reached the VeggieMeet team.");
    },
    onError: (e) => {
      showErrorToast(e, { surface: "beta_feedback" });
      logAnalyticsEvent("beta_feedback_failed", { category, surface });
    },
  });

  return (
    <div className="flex flex-col min-h-dvh">
      <AppHeader
        title="Send beta feedback"
        left={
          <BackButton fallback="/settings" />
        }
      />

      <div className="flex-1 px-5 py-4 space-y-4">
        {sent ? (
          <Card className="p-5 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-soft-green text-primary flex items-center justify-center">
              <MessageSquareHeart className="w-6 h-6" />
            </div>
            <h2 className="mt-3 text-base font-semibold text-charcoal">
              Feedback received
            </h2>
            <p className="mt-1 text-sm text-charcoal-muted">
              We read every private beta note. We may not reply to each one, but
              it goes straight to the people building VeggieMeet.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <PrimaryButton onClick={() => navigate("/settings")}>
                Back to Settings
              </PrimaryButton>
              <button
                type="button"
                className="text-sm font-medium text-primary min-h-11"
                onClick={() => {
                  setSent(false);
                  setMessage("");
                }}
              >
                Send another note
              </button>
            </div>
          </Card>
        ) : (
          <>
            <p className="text-sm text-charcoal-muted leading-relaxed">
              Tell us what felt broken, confusing, or missing. This goes only to
              the VeggieMeet team — never to other members.
            </p>

            <div className="p-3 rounded-2xl bg-muted/40 border border-border text-xs text-charcoal-muted">
              Something unsafe, or about a person? Use the{" "}
              <button
                type="button"
                onClick={() => navigate("/safety")}
                className="font-semibold text-primary underline"
              >
                Safety &amp; Trust Center
              </button>{" "}
              instead, so it reaches the right process.
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-charcoal">
                What kind of feedback is it?
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={category === c.id}
                    onClick={() => setCategory(c.id)}
                    className={`px-4 min-h-11 rounded-full text-sm font-medium border ${
                      category === c.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-charcoal border-border"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="feedback-surface"
                className="text-sm font-semibold text-charcoal"
              >
                Where did it happen?
              </label>
              <select
                id="feedback-surface"
                value={surface}
                onChange={(e) => setSurface(e.target.value as FeedbackSurface)}
                className="mt-2 w-full min-h-12 rounded-2xl bg-card border border-border px-3 text-sm text-charcoal"
              >
                {FEEDBACK_SURFACES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="feedback-message"
                className="text-sm font-semibold text-charcoal"
              >
                What happened?
              </label>
              <Textarea
                id="feedback-message"
                value={message}
                maxLength={FEEDBACK_MAX}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                className="mt-2"
                placeholder="I tried to join a Meetup and the button did nothing…"
                aria-describedby="feedback-help"
              />
              <div
                id="feedback-help"
                className="mt-1 flex items-center justify-between text-xs text-charcoal-muted"
              >
                <span>
                  {tooShort
                    ? `Add a little more detail (at least ${FEEDBACK_MIN} characters).`
                    : "Please don't include other people's personal details."}
                </span>
                <span>
                  {trimmed.length}/{FEEDBACK_MAX}
                </span>
              </div>
            </div>

            <PrimaryButton
              onClick={() => send.mutate()}
              disabled={!canSend || send.isPending}
            >
              {send.isPending ? "Sending…" : "Send feedback"}
            </PrimaryButton>

            <p className="text-xs text-charcoal-muted">
              We attach your build version ({APP_VERSION}) and the screen name so
              we can reproduce the issue. Nothing else is collected.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
