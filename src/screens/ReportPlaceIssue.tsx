import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AppHeader, BackButton } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchCommunityPlaceById } from "@/lib/backend";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  REPORT_LIMITS,
  REPORT_REASONS,
  submitPlaceReport,
  type PlaceReportReason,
  type ReportSubmitReason,
} from "@/lib/placeReports";

type FieldKey = "reasonCode" | "explanation" | "officialSourceUrl" | "additionalDetails";

/** Every failure path maps to calm, non-technical copy. No raw errors surface. */
const REASON_COPY: Record<ReportSubmitReason, { title: string; body: string }> = {
  report_submitted: { title: "", body: "" },
  invalid_reason: {
    title: "Please choose what's wrong",
    body: "Pick the option that best matches what you noticed.",
  },
  invalid_input: {
    title: "Please check your details",
    body: "Tell us a little more (at least 20 characters) and keep it under the length limits.",
  },
  invalid_url: {
    title: "That link doesn't look right",
    body: "Add a link starting with http:// or https://, or leave it empty.",
  },
  duplicate_report: {
    title: "You already reported this",
    body: "We already have your report about this issue and it's still being reviewed.",
  },
  report_limit_reached: {
    title: "You've reached today's limit",
    body: "You can send up to 5 reports per day. Please try again tomorrow.",
  },
  place_not_found: {
    title: "This place isn't available",
    body: "It may have been removed. Try again from the place page.",
  },
  unauthenticated: {
    title: "Please sign in again",
    body: "We couldn't confirm your account. Sign in and try once more.",
  },
};

export default function ReportPlaceIssue() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const placeQ = useQuery({
    queryKey: ["community-place", id],
    enabled: !!id,
    queryFn: () => fetchCommunityPlaceById(id),
  });
  const placeName = placeQ.data?.name ?? "this place";

  const [reasonCode, setReasonCode] = useState<PlaceReportReason | "">("");
  const [explanation, setExplanation] = useState("");
  const [officialSourceUrl, setOfficialSourceUrl] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<{ title: string; body: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !id) return;
    startedRef.current = true;
    logAnalyticsEvent("community_place_report_started", { place_id: id });
  }, [id]);

  const selectedHint = useMemo(
    () => REPORT_REASONS.find((r) => r.value === reasonCode)?.hint ?? "",
    [reasonCode],
  );

  function validate() {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!reasonCode) next.reasonCode = "Choose what's wrong with this place.";
    const expl = explanation.trim();
    if (expl.length < REPORT_LIMITS.explanationMin)
      next.explanation = `Please add at least ${REPORT_LIMITS.explanationMin} characters.`;
    else if (expl.length > REPORT_LIMITS.explanation)
      next.explanation = "This is too long.";
    const url = officialSourceUrl.trim();
    if (url && !/^https?:\/\/\S+\.\S+/i.test(url))
      next.officialSourceUrl = "Add a link starting with http:// or https://.";
    if (additionalDetails.trim().length > REPORT_LIMITS.additionalDetails)
      next.additionalDetails = "This is too long.";
    setErrors(next);
    const firstKey = Object.keys(next)[0];
    if (firstKey) refs.current[firstKey]?.focus();
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await submitPlaceReport({
        placeId: id,
        reasonCode: reasonCode as PlaceReportReason,
        explanation,
        officialSourceUrl,
        additionalDetails,
      });
      if (res.ok) {
        logAnalyticsEvent("community_place_report_submitted", {
          place_id: id,
          reason_code: reasonCode,
        });
        setDone(true);
        return;
      }
      logAnalyticsEvent("community_place_report_blocked", {
        place_id: id,
        reason: res.reason,
      });
      setFormError(REASON_COPY[res.reason] ?? REASON_COPY.invalid_input);
    } catch {
      setFormError({
        title: "We couldn't send your report",
        body: "Something went wrong on our side. Please try again in a moment.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <>
        <AppHeader title="Report sent" />
        <div className="px-5 pt-10 pb-24 animate-fade-in">
          <div
            role="status"
            aria-live="polite"
            className="mx-auto w-full max-w-xl text-center"
          >
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-charcoal">Thanks for the heads-up</h1>
            <p className="mt-2 text-sm text-charcoal-muted [overflow-wrap:anywhere]">
              Your report was received. Our team reviews every report before anything on {placeName}{" "}
              changes. Nothing about this place has changed yet.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button onClick={() => navigate("/you/place-reports?from=report_success")}>
                View my reports
              </Button>
              <Button variant="outline" onClick={() => navigate(`/place/${id}`)}>
                Back to the place
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader
        left={
          <BackButton fallback="/community/places" />
        }
        title="Report an issue"
      />

      <form onSubmit={onSubmit} className="px-5 pt-4 pb-28 animate-fade-in" noValidate>
        <div className="mx-auto w-full min-w-0 max-w-xl space-y-5">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-charcoal [overflow-wrap:anywhere]">
              {placeName}
            </h1>
            <p className="mt-1 text-sm text-charcoal-muted">
              Reports are private and reviewed by the VeggieMeet team. Sending a report doesn't
              change this place — nothing is published automatically.
            </p>
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-card border border-warning-border bg-warning-soft p-3.5 min-w-0"
            >
              <p className="text-sm font-semibold text-charcoal">{formError.title}</p>
              <p className="mt-1 text-xs text-charcoal-muted [overflow-wrap:anywhere]">
                {formError.body}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reasonCode">What's wrong?</Label>
            <select
              id="reasonCode"
              ref={(el) => (refs.current.reasonCode = el)}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as PlaceReportReason)}
              aria-invalid={!!errors.reasonCode}
              aria-describedby={errors.reasonCode ? "reasonCode-error" : "reasonCode-hint"}
              className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Choose an option</option>
              {REPORT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {errors.reasonCode ? (
              <p id="reasonCode-error" className="text-xs text-destructive">
                {errors.reasonCode}
              </p>
            ) : (
              <p id="reasonCode-hint" className="text-xs text-charcoal-muted">
                {selectedHint || "Pick the closest match."}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="explanation">What did you notice?</Label>
            <Textarea
              id="explanation"
              rows={4}
              ref={(el) => (refs.current.explanation = el)}
              value={explanation}
              maxLength={REPORT_LIMITS.explanation}
              onChange={(e) => setExplanation(e.target.value)}
              aria-invalid={!!errors.explanation}
              aria-describedby={errors.explanation ? "explanation-error" : "explanation-hint"}
              placeholder="For example: the door was closed and a sign said the restaurant moved."
            />
            {errors.explanation ? (
              <p id="explanation-error" className="text-xs text-destructive">
                {errors.explanation}
              </p>
            ) : (
              <p id="explanation-hint" className="text-xs text-charcoal-muted">
                {explanation.trim().length}/{REPORT_LIMITS.explanation} characters · at least{" "}
                {REPORT_LIMITS.explanationMin}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="officialSourceUrl">Link to a source (optional)</Label>
            <Input
              id="officialSourceUrl"
              type="url"
              inputMode="url"
              ref={(el) => (refs.current.officialSourceUrl = el)}
              value={officialSourceUrl}
              maxLength={REPORT_LIMITS.officialSourceUrl}
              onChange={(e) => setOfficialSourceUrl(e.target.value)}
              aria-invalid={!!errors.officialSourceUrl}
              aria-describedby={
                errors.officialSourceUrl ? "officialSourceUrl-error" : "officialSourceUrl-hint"
              }
              placeholder="https://"
            />
            {errors.officialSourceUrl ? (
              <p id="officialSourceUrl-error" className="text-xs text-destructive">
                {errors.officialSourceUrl}
              </p>
            ) : (
              <p id="officialSourceUrl-hint" className="text-xs text-charcoal-muted">
                An official website, menu, or social post helps us verify faster.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="additionalDetails">Anything else? (optional)</Label>
            <Textarea
              id="additionalDetails"
              rows={3}
              ref={(el) => (refs.current.additionalDetails = el)}
              value={additionalDetails}
              maxLength={REPORT_LIMITS.additionalDetails}
              onChange={(e) => setAdditionalDetails(e.target.value)}
              aria-invalid={!!errors.additionalDetails}
              aria-describedby={
                errors.additionalDetails ? "additionalDetails-error" : "additionalDetails-hint"
              }
            />
            {errors.additionalDetails ? (
              <p id="additionalDetails-error" className="text-xs text-destructive">
                {errors.additionalDetails}
              </p>
            ) : (
              <p id="additionalDetails-hint" className="text-xs text-charcoal-muted">
                Please don't include personal information about other people.
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Send report"}
          </Button>
          <p className="text-xs text-charcoal-muted">
            You can send up to 5 reports per day.
          </p>
        </div>
      </form>
    </>
  );
}
