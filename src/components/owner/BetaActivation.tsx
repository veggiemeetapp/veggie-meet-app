import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, LoadingSkeleton } from "@/components/app";
import {
  ACTIVATION_WINDOWS,
  ONBOARDING_STEP_LABEL,
  activationStages,
  biggestOnboardingDrop,
  eventCount,
  fetchActivationSummary,
  formatRatio,
  isEmptyActivation,
  members,
  updatedLabel,
  type ActivationWindow,
} from "@/lib/betaActivation";

/**
 * WO-097 — Beta activation, nested inside the existing owner beta operations
 * screen (`/owner/beta`). Aggregates only: no member names, emails, ids or
 * per-member rows exist here, and no metric links through to a member. Server
 * authority is `is_owner()` inside `get_beta_activation_summary()`; the route is
 * additionally wrapped by RequireOwner.
 */

function Metric({
  label,
  members: m,
  events,
  hint,
}: {
  label: string;
  members?: number | string;
  events?: number;
  hint?: string;
}) {
  return (
    <Card variant="metric" padding="sm">
      <div className="text-xs text-charcoal-muted break-words">{label}</div>
      <div className="text-lg font-semibold text-charcoal">
        {m ?? "—"}
        {m !== undefined && typeof m === "number" && (
          <span className="sr-only"> members</span>
        )}
      </div>
      {events !== undefined && (
        <div className="text-[11px] text-charcoal-muted">{events} events</div>
      )}
      {hint && <div className="text-[11px] text-charcoal-muted">{hint}</div>}
    </Card>
  );
}

function Group({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="text-sm font-semibold text-charcoal">
        {title}
      </h3>
      {note && <p className="mt-0.5 text-xs text-charcoal-muted">{note}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </section>
  );
}

export function BetaActivation() {
  const [window, setWindow] = useState<ActivationWindow>("7d");

  const q = useQuery({
    queryKey: ["beta-activation", window],
    queryFn: () => fetchActivationSummary(window),
    staleTime: 60_000,
  });

  const s = q.data;
  const stages = s ? activationStages(s) : [];
  const drop = s ? biggestOnboardingDrop(s.onboarding_steps ?? []) : null;

  return (
    <section aria-labelledby="beta-activation-h" className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="beta-activation-h" className="text-sm font-semibold text-charcoal">
            Beta activation
          </h2>
          <p className="mt-1 text-xs text-charcoal-muted">
            Activation shows how far new members are getting through VeggieMeet.
            Counts are aggregated and do not expose individual member activity.
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh activation"
          className="w-11 h-11 -mr-1 rounded-full flex items-center justify-center hover:bg-accent/40"
          onClick={() => void q.refetch()}
        >
          <RefreshCw className="w-5 h-5 text-charcoal" />
        </button>
      </div>

      <div
        role="group"
        aria-label="Activation time window"
        className="flex flex-wrap gap-2"
      >
        {ACTIVATION_WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={window === w.id}
            onClick={() => setWindow(w.id)}
            className={`px-3 min-h-11 rounded-full text-xs font-medium border ${
              window === w.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-charcoal border-border"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {q.isPending ? (
        <div className="space-y-2" aria-live="polite">
          <span className="sr-only">Loading activation data</span>
          <LoadingSkeleton className="h-4 w-40" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-[68px] w-full rounded-card" />
            ))}
          </div>
        </div>
      ) : q.isError || !s ? (
        <Card padding="md">
          <p className="text-sm text-charcoal">Activation data couldn't be loaded.</p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-3 inline-flex items-center justify-center min-h-11 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium"
          >
            Retry
          </button>
        </Card>
      ) : (
        <div className="space-y-5 min-w-0">
          <p className="text-xs text-charcoal-muted">
            {updatedLabel(s.generated_at)} · window counted in{" "}
            {s.product_timezone.replace(/_/g, " ")}
          </p>

          {isEmptyActivation(s) ? (
            <Card padding="md">
              <p className="text-sm text-charcoal">No beta member activity yet.</p>
              <p className="mt-1 text-xs text-charcoal-muted">
                Counts appear here as members join and use the app in this window.
              </p>
            </Card>
          ) : null}

          <Group
            id="act-stages-h"
            title="Members reaching each activation stage"
            note="Each member is counted once per stage. Stages are separate reach measures, not a strict step-by-step sequence."
          >
            {stages.map((st) => (
              <Metric key={st.key} label={st.label} members={st.members} />
            ))}
          </Group>

          <Group
            id="act-auth-h"
            title="Joining"
            note="Members and event volume for account creation."
          >
            <Metric
              label="Signup started"
              members={members(s, "auth_signup_started")}
              events={eventCount(s, "auth_signup_started")}
            />
            <Metric
              label="Signup succeeded"
              members={members(s, "auth_signup_success")}
              events={eventCount(s, "auth_signup_success")}
              hint={`${formatRatio(
                members(s, "auth_signup_success"),
                members(s, "auth_signup_started"),
              )} of started`}
            />
            <Metric
              label="Completed onboarding"
              members={members(s, "onboarding_completed")}
              hint={`${formatRatio(
                members(s, "onboarding_completed"),
                members(s, "auth_signup_success"),
              )} of signups`}
            />
            <Metric
              label="Sign-ins"
              members={members(s, "auth_signin_success")}
              events={eventCount(s, "auth_signin_success")}
            />
          </Group>

          <Group
            id="act-orient-h"
            title="Orientation"
            note="Surfaces members reached after onboarding."
          >
            <Metric
              label="Reached Today"
              members={members(s, "today_opened")}
              events={eventCount(s, "today_opened")}
              hint={`${formatRatio(
                members(s, "today_opened"),
                members(s, "onboarding_completed"),
              )} of onboarded`}
            />
            <Metric
              label="Opened Community"
              members={members(s, "community_home_opened")}
              events={eventCount(s, "community_home_opened")}
            />
            <Metric
              label="Opened both Today and Community"
              members={s.today_and_community_members}
            />
            <Metric label="Opened Plans" members={members(s, "my_plans_opened")} />
            <Metric
              label="Opened Notifications"
              members={members(s, "notifications_opened")}
            />
            <Metric label="Opened You" members={members(s, "you_opened")} />
            <Metric label="Opened Settings" members={members(s, "settings_opened")} />
            <Metric
              label="Opened Beta feedback"
              members={members(s, "beta_feedback_opened")}
            />
          </Group>

          <Group
            id="act-place-h"
            title="Community Place interest"
            note="Aggregate only — no place or member pairing is shown."
          >
            <Metric
              label="Places list opened"
              members={members(s, "community_places_opened")}
              events={eventCount(s, "community_places_opened")}
            />
            <Metric
              label="Place detail opened"
              members={members(s, "community_place_detail_opened")}
              events={eventCount(s, "community_place_detail_opened")}
            />
            <Metric
              label="Check In started"
              members={members(s, "community_place_check_in_started")}
              events={eventCount(s, "community_place_check_in_started")}
            />
            <Metric
              label="Check In succeeded"
              members={members(s, "community_place_check_in_succeeded")}
              events={eventCount(s, "community_place_check_in_succeeded")}
            />
            <Metric
              label="Check In failed"
              members={members(s, "community_place_check_in_failed")}
              events={eventCount(s, "community_place_check_in_failed")}
            />
          </Group>

          <Group
            id="act-host-h"
            title="Host intent"
            note="Opening Host is intent only — it is not a created Meetup."
          >
            <Metric label="Opened Host" members={members(s, "host_opened")} />
            <Metric
              label="Meetup created"
              members={members(s, "meetup_created")}
              events={eventCount(s, "meetup_created")}
            />
            <Metric
              label="Meetup created at a Community Place"
              members={members(s, "meetup_created_at_community_place")}
              events={eventCount(s, "meetup_created_at_community_place")}
            />
            <Metric
              label="Meetup joined"
              members={members(s, "meetup_joined")}
              events={eventCount(s, "meetup_joined")}
            />
          </Group>

          <Group
            id="act-meet-h"
            title="Meet Veggies intent"
            note="Connection requests are separate from verified connections made in person."
          >
            <Metric label="Opened Meet Next" members={members(s, "meet_next_opened")} />
            <Metric label="Opened Network" members={members(s, "network_opened")} />
            <Metric
              label="Connection request sent"
              members={members(s, "connection_request_sent")}
              events={eventCount(s, "connection_request_sent")}
            />
            <Metric
              label="Connection request accepted"
              members={members(s, "connection_request_accepted")}
              events={eventCount(s, "connection_request_accepted")}
            />
          </Group>

          <section aria-labelledby="act-steps-h" className="min-w-0">
            <h3 id="act-steps-h" className="text-sm font-semibold text-charcoal">
              Onboarding step reach
            </h3>
            <p className="mt-0.5 text-xs text-charcoal-muted">
              Members who reached each step. Individual progress is never shown.
            </p>
            <ul className="mt-2 space-y-1">
              {(s.onboarding_steps ?? []).map((st) => (
                <li
                  key={st.step}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-control bg-card border border-border text-xs"
                >
                  <span className="text-charcoal min-w-0 break-words">
                    {ONBOARDING_STEP_LABEL[st.step] ?? st.step}
                  </span>
                  <span className="font-semibold text-charcoal shrink-0">
                    {st.members}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-charcoal-muted">
              {drop
                ? `Largest step-to-step drop: ${
                    ONBOARDING_STEP_LABEL[drop.from] ?? drop.from
                  } → ${ONBOARDING_STEP_LABEL[drop.to] ?? drop.to} (${drop.drop})`
                : "No step-to-step drop to report in this window."}
            </p>
          </section>

          <p className="text-xs text-charcoal-muted">
            Total activation events in window: {s.total_events}
          </p>
        </div>
      )}
    </section>
  );
}
