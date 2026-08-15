import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { AppHeader, BackButton } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocationContext } from "@/hooks/useLocation";
import { fetchPublishedCommunityPlaces } from "@/lib/backend";
import { logAnalyticsEvent } from "@/lib/analytics";
import {
  checkSuggestionDuplicate,
  submitPlaceSuggestion,
  DUPLICATE_REASON_LABEL,
  type DuplicateCheck,
  type SubmitReason,
} from "@/lib/placeSuggestions";

const LIMITS = {
  placeName: 120,
  addressText: 240,
  officialSourceUrl: 500,
  veganReason: 600,
  submitterNote: 600,
};

type FieldKey = "placeName" | "cityId" | "addressText" | "officialSourceUrl" | "veganReason";

const REASON_COPY: Record<SubmitReason, { title: string; body: string }> = {
  success: { title: "", body: "" },
  invalid_input: {
    title: "Please check your details",
    body: "Some information is missing or too long.",
  },
  invalid_url: {
    title: "That link doesn’t look right",
    body: "Please add an official website or social page starting with http:// or https://.",
  },
  duplicate_suggestion: {
    title: "This place may already be listed",
    body: "We already have a similar place in our review queue.",
  },
  duplicate_published_place: {
    title: "This place is already on VeggieMeet.",
    body: "We found a Community Place at this address.",
  },
  duplicate_active_suggestion: {
    title: "This location has already been suggested",
    body: "It's awaiting review, so there's nothing more to do right now.",
  },
  submission_limit_reached: {
    title: "You’ve reached today’s limit",
    body: "You can suggest up to 5 places per day. Please try again tomorrow.",
  },
  unsupported_city: {
    title: "We’re not in that city yet",
    body: "VeggieMeet Community Places aren’t open in this city yet.",
  },
  unauthenticated: {
    title: "Please sign in again",
    body: "We couldn’t confirm your account. Sign in and try once more.",
  },
};

export default function SuggestPlace() {
  const navigate = useNavigate();
  const location = useLocationContext();
  const selectedCity = location.data?.selected_city ?? null;

  const placesQ = useQuery({
    queryKey: ["published-places-all"],
    queryFn: () => fetchPublishedCommunityPlaces(null),
    staleTime: 300_000,
  });

  // Only cities that already have a published Community Place are supported —
  // this mirrors the server-side city check so we never imply otherwise.
  const supportedCities = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of placesQ.data ?? []) {
      if (p.cityId) map.set(p.cityId, p.cityName ?? "This city");
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [placesQ.data]);

  const [placeName, setPlaceName] = useState("");
  const [cityId, setCityId] = useState("");
  const [addressText, setAddressText] = useState("");
  const [officialSourceUrl, setOfficialSourceUrl] = useState("");
  const [veganReason, setVeganReason] = useState("");
  const [submitterNote, setSubmitterNote] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<{ title: string; body: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // WO-110: a possible match warns once, then submission continues. Only an
  // exact physical duplicate (server-decided) blocks the member.
  const [similar, setSimilar] = useState<DuplicateCheck | null>(null);
  const [blocked, setBlocked] = useState<DuplicateCheck | null>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    logAnalyticsEvent("community_place_suggestion_started", { source: "community_places" });
  }, []);

  useEffect(() => {
    if (cityId) return;
    if (selectedCity && supportedCities.some((c) => c.id === selectedCity.id)) {
      setCityId(selectedCity.id);
    } else if (supportedCities.length === 1) {
      setCityId(supportedCities[0].id);
    }
  }, [cityId, selectedCity, supportedCities]);

  function validate() {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!placeName.trim()) next.placeName = "Please add the place name.";
    else if (placeName.trim().length > LIMITS.placeName)
      next.placeName = `Please keep the name under ${LIMITS.placeName} characters.`;
    if (!cityId) next.cityId = "Please choose a city.";
    if (!addressText.trim()) next.addressText = "Please add an address or neighborhood.";
    if (!officialSourceUrl.trim())
      next.officialSourceUrl = "Please add an official website or social page.";
    else if (!/^https?:\/\/\S+\.\S+/i.test(officialSourceUrl.trim()))
      next.officialSourceUrl = "Links must start with http:// or https://.";
    if (!veganReason.trim())
      next.veganReason = "Please tell us why this place is 100% vegan.";
    return next;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    const next = validate();
    setErrors(next);
    const firstKey = (["placeName", "cityId", "addressText", "officialSourceUrl", "veganReason"] as FieldKey[]).find(
      (k) => next[k],
    );
    if (firstKey) {
      refs.current[firstKey]?.focus();
      logAnalyticsEvent("community_place_suggestion_failed", { safe_reason_code: "invalid_input" });
      return;
    }

    setSubmitting(true);
    try {
      // Supplemental UX only — the server re-enforces on submit.
      if (!similar) {
        let check: DuplicateCheck = { level: "none" };
        try {
          check = await checkSuggestionDuplicate({
            cityId,
            placeName,
            addressText,
            officialSourceUrl,
          });
        } catch {
          check = { level: "none" };
        }
        if (check.level === "hard") {
          setBlocked(check);
          setFormError(
            check.entity_type === "place"
              ? REASON_COPY.duplicate_published_place
              : REASON_COPY.duplicate_active_suggestion,
          );
          logAnalyticsEvent("community_place_suggestion_failed", {
            safe_reason_code:
              check.entity_type === "place"
                ? "duplicate_published_place"
                : "duplicate_active_suggestion",
          });
          setSubmitting(false);
          return;
        }
        if (check.level === "possible") {
          setSimilar(check);
          logAnalyticsEvent("community_place_suggestion_possible_duplicate_shown", {
            match_entity_type: check.entity_type ?? "unknown",
          });
          setSubmitting(false);
          return;
        }
      }

      const res = await submitPlaceSuggestion({
        cityId,
        placeName,
        addressText,
        officialSourceUrl,
        veganReason,
        submitterNote,
      });
      if (res.ok) {
        logAnalyticsEvent("community_place_suggestion_submitted", {
          city_id: cityId,
          has_optional_note: submitterNote.trim().length > 0,
        });
        setDone(true);
      } else {
        logAnalyticsEvent("community_place_suggestion_failed", { safe_reason_code: res.reason });
        if (res.reason === "duplicate_published_place") {
          setBlocked({
            level: "hard",
            entity_type: "place",
            match_name: res.match_name ?? undefined,
            published_place_id: res.published_place_id ?? null,
          });
        }
        setFormError(REASON_COPY[res.reason] ?? REASON_COPY.invalid_input);
      }
    } catch {
      logAnalyticsEvent("community_place_suggestion_failed", { safe_reason_code: "invalid_input" });
      setFormError({
        title: "Something went wrong",
        body: "We couldn’t send your suggestion. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <>
        <AppHeader title="Suggestion sent" />
        <div className="px-5 pt-8 pb-24 animate-fade-in" role="status" aria-live="polite">
          <div className="mx-auto max-w-md text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden />
            <h2 className="mt-4 text-xl font-semibold text-charcoal">Suggestion sent</h2>
            <p className="mt-2 text-sm text-charcoal-muted">
              Thanks for helping grow the VeggieMeet community. We’ll review the place before it
              can appear publicly.
            </p>
            <div className="mt-8 space-y-3">
              <Button
                className="w-full"
                onClick={() => navigate("/you/place-suggestions?from=suggestion_success")}
              >

                Done
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/community/places">View Community Places</Link>
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
        title="Suggest a Community Place"
      />

      <div className="px-5 pt-4 pb-28 animate-fade-in">
        <div className="mx-auto w-full max-w-xl">
          <p className="text-sm text-charcoal-muted">
            Share a place you believe is 100% vegan. Every suggestion is reviewed before it appears
            in VeggieMeet.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
            <Field
              id="place-name"
              label="Place name"
              required
              error={errors.placeName}
            >
              <Input
                id="place-name"
                ref={(el) => (refs.current.placeName = el)}
                value={placeName}
                onChange={(e) => {
                  setPlaceName(e.target.value);
                  setSimilar(null);
                  setBlocked(null);
                  setFormError(null);
                }}
                maxLength={LIMITS.placeName}
                placeholder="Example: Green Table Vegan Café"
                aria-required="true"
                aria-invalid={!!errors.placeName}
                aria-describedby={errors.placeName ? "place-name-error" : undefined}
              />
            </Field>

            <Field id="city" label="City" required error={errors.cityId}>
              {placesQ.isPending ? (
                <div className="h-10 rounded-md bg-muted animate-pulse" />
              ) : supportedCities.length <= 1 ? (
                <>
                  <Input
                    id="city"
                    ref={(el) => (refs.current.cityId = el)}
                    value={supportedCities[0]?.name ?? ""}
                    readOnly
                    aria-required="true"
                    aria-describedby="city-help"
                  />
                  <p id="city-help" className="mt-1.5 text-xs text-charcoal-muted">
                    Community Places are open in {supportedCities[0]?.name ?? "one city"} for now.
                  </p>
                </>
              ) : (
                <select
                  id="city"
                  ref={(el) => (refs.current.cityId = el)}
                  value={cityId}
                  onChange={(e) => setCityId(e.target.value)}
                  aria-required="true"
                  aria-invalid={!!errors.cityId}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select a city</option>
                  {supportedCities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              id="address"
              label="Address or neighborhood"
              required
              error={errors.addressText}
            >
              <Input
                id="address"
                ref={(el) => (refs.current.addressText = el)}
                value={addressText}
                onChange={(e) => {
                  setAddressText(e.target.value);
                  setSimilar(null);
                  setBlocked(null);
                  setFormError(null);
                }}
                maxLength={LIMITS.addressText}
                placeholder="Example: District 1 or 29 Lê Anh Xuân"
                aria-required="true"
                aria-invalid={!!errors.addressText}
                aria-describedby={errors.addressText ? "address-error" : undefined}
              />
            </Field>

            <Field
              id="source"
              label="Official website or social page"
              required
              help="Share an official source that helps confirm the place is fully vegan."
              error={errors.officialSourceUrl}
            >
              <Input
                id="source"
                ref={(el) => (refs.current.officialSourceUrl = el)}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={officialSourceUrl}
                onChange={(e) => setOfficialSourceUrl(e.target.value)}
                maxLength={LIMITS.officialSourceUrl}
                placeholder="https://"
                aria-required="true"
                aria-invalid={!!errors.officialSourceUrl}
                aria-describedby={`source-help${errors.officialSourceUrl ? " source-error" : ""}`}
                className="break-all"
              />
            </Field>

            <Field
              id="vegan-reason"
              label="Why is this place 100% vegan?"
              required
              error={errors.veganReason}
            >
              <Textarea
                id="vegan-reason"
                ref={(el) => (refs.current.veganReason = el)}
                rows={4}
                value={veganReason}
                onChange={(e) => setVeganReason(e.target.value)}
                maxLength={LIMITS.veganReason}
                placeholder="Example: Their official menu says every food and drink item is vegan."
                aria-required="true"
                aria-invalid={!!errors.veganReason}
                aria-describedby={errors.veganReason ? "vegan-reason-error" : undefined}
              />
            </Field>

            <Field id="note" label="Anything else we should know?">
              <Textarea
                id="note"
                rows={3}
                value={submitterNote}
                onChange={(e) => setSubmitterNote(e.target.value)}
                maxLength={LIMITS.submitterNote}
                placeholder="Branch details, recent name changes, or other useful context."
              />
            </Field>

            <div aria-live="polite">
              {similar && !blocked && (
                <div
                  role="status"
                  className="mb-3 rounded-control border border-warning/40 bg-warning/10 p-3"
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                    Similar place found
                  </p>
                  <p className="mt-1 text-sm text-charcoal-muted [overflow-wrap:anywhere]">
                    We found a place with a similar name
                    {similar.match_name ? ` (${similar.match_name})` : ""}. If this is a different
                    branch or location, you can still submit it for review.
                  </p>
                  {similar.reasons && similar.reasons.length > 0 && (
                    <p className="mt-1 text-xs text-charcoal-muted">
                      {similar.reasons
                        .map((r) => DUPLICATE_REASON_LABEL[r] ?? r)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              )}
              {formError && (
                <div className="rounded-control border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-semibold text-charcoal">{formError.title}</p>
                  <p className="mt-0.5 text-sm text-charcoal-muted">{formError.body}</p>
                </div>
              )}
            </div>

            {blocked?.published_place_id && (
              <Button variant="outline" className="w-full" asChild>
                <Link to={`/place/${blocked.published_place_id}`}>View Community Place</Link>
              </Button>
            )}

            <Button type="submit" className="w-full" disabled={submitting || !!blocked}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Sending…
                </>
              ) : (
                "Suggest a Place"
              )}
            </Button>
            <p className="text-xs text-charcoal-muted text-center">
              Suggesting a place does not publish it. Only 100% vegan places qualify.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

function Field({
  id,
  label,
  required,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-sm font-medium text-charcoal">
        {label}
        {required && <span className="text-charcoal-muted font-normal"> (required)</span>}
      </Label>
      {help && (
        <p id={`${id}-help`} className="mt-1 text-xs text-charcoal-muted">
          {help}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
