import { memberSafeMessage } from "@/lib/errors";
import { BackButton } from "@/components/app";
import { safeBack } from "@/lib/navigation";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Leaf,
  MapPin,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  UserAvatar,
} from "@/components/app";
import { useAuth } from "@/hooks/useAuth";
import {
  dismissFollowUp,
  getHostMeetupSummary,
  getMyMeetupSummary,
  markFollowUpViewed,
  submitMeetupFeedback,
  type FeedbackRating,
  type MyMeetupSummary,
} from "@/lib/postMeetup";
import { ReportMeetupDialog } from "@/components/safety/ReportMeetupDialog";
import { sanitizeCover } from "@/lib/backend";
import { formatMeetupDate, formatMeetupTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const RATING_OPTIONS: { value: FeedbackRating; label: string; hint: string }[] = [
  { value: "great", label: "Great experience", hint: "I'd do this again." },
  { value: "okay", label: "It was okay", hint: "It was fine, nothing special." },
  { value: "not_for_me", label: "Not for me", hint: "It wasn't a fit." },
];

const REPORT_REASONS = [
  "Safety concern",
  "Misleading Meetup information",
  "Inappropriate host behavior",
  "Harassment",
  "Discrimination",
  "Other",
];

export default function MeetupSummary() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ["meetup-summary", id, profile?.id],
    enabled: !!id && !!profile?.id,
    queryFn: () => getMyMeetupSummary(id!),
    retry: false,
  });

  const hostQuery = useQuery({
    queryKey: ["host-summary", id, profile?.id],
    enabled: !!id && !!profile?.id && !!summaryQuery.data?.is_host,
    queryFn: () => getHostMeetupSummary(id!),
  });

  useEffect(() => {
    if (!id || !profile?.id || !summaryQuery.data) return;
    if (!summaryQuery.data.meetup.has_ended) return;
    markFollowUpViewed(id).catch(() => {});
  }, [id, profile?.id, summaryQuery.data]);

  // Realtime: verified pairs & attendance transitions
  useEffect(() => {
    if (!id || !profile?.id) return;
    const channel = supabase
      .channel(`summary:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "verified_meetup_connections", filter: `meetup_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["meetup-summary", id] });
          qc.invalidateQueries({ queryKey: ["host-summary", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meetup_feedback", filter: `meetup_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["host-summary", id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, profile?.id, qc]);

  if (!id) return null;

  if (summaryQuery.isLoading) {
    return (
      <>
        <SummaryHeader />
        <div className="px-5 mt-2 space-y-4">
          <Card className="h-48 animate-pulse" />
          <Card className="h-32 animate-pulse" />
          <Card className="h-40 animate-pulse" />
        </div>
      </>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <>
        <SummaryHeader />
        <EmptyState
          icon={<XCircle className="w-6 h-6" />}
          title="We couldn't load this Meetup summary."
          description={summaryQuery.error instanceof Error ? summaryQuery.error.message : undefined}
          action={
            <div className="flex gap-2">
              <SecondaryButton onClick={() => safeBack(navigate, "/plans")}>Back</SecondaryButton>
              <PrimaryButton onClick={() => summaryQuery.refetch()}>Try again</PrimaryButton>
            </div>
          }
        />
      </>
    );
  }

  const s = summaryQuery.data;

  return (
    <>
      <SummaryHeader />
      <div className="px-5 mt-2 pb-16 space-y-6">
        <OverviewCard summary={s} />
        {s.attendance_status === "removed" ? (
          <RemovedCard meetupId={id} />
        ) : s.meetup.status === "cancelled" ? (
          <CancelledCard meetupId={id} />
        ) : !s.meetup.has_ended ? (
          <NotYetCard />
        ) : (
          <>
            {!s.is_host && (
              <>
                {(s.attendance_status === "checked_in" ||
                  s.attendance_status === "attended") && (
                  <>
                    <VerifiedSection summary={s} />
                    <CommunityImpactCard summary={s} />
                  </>
                )}
                <ReflectionCard summary={s} onSubmitted={() => summaryQuery.refetch()} />
              </>
            )}
            {s.is_host && (
              <HostSection loading={hostQuery.isLoading} data={hostQuery.data} />
            )}
          </>
        )}
        <SafetyCard meetupId={id} hostName={s.host?.display_name ?? null} />
      </div>
    </>
  );

  function SummaryHeader() {
    return (
      <AppHeader
        title="Meetup Summary"
        left={
          <BackButton fallback="/plans" />
        }
      />
    );
  }
}

function OverviewCard({ summary }: { summary: MyMeetupSummary }) {
  const m = summary.meetup;
  const cover = sanitizeCover(m.cover_image_url);
  const locationName =
    summary.place?.name ??
    m.custom_location_name ??
    "Location";
  const address = summary.place?.address ?? m.custom_location_address ?? null;
  const attendanceLine =
    summary.attendance_status === "removed"
      ? "You were removed from this Meetup."
      : summary.is_host
        ? `You hosted ${m.title}.`
        : summary.attendance_status === "checked_in" || summary.attendance_status === "attended"
          ? `You checked in at ${m.title}.`
          : `You were signed up for ${m.title}.`;

  return (
    <Card padding="none" className="overflow-hidden">
      <div
        className="h-36 w-full bg-cover bg-center"
        style={{ backgroundImage: `url(${cover})` }}
        role="img"
        aria-label={m.title}
      />
      <div className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-charcoal-muted">
          {summary.is_host ? "Your Meetup" : "Your Meetup Summary"}
        </div>
        <h1 className="mt-0.5 text-lg font-semibold text-charcoal">{m.title}</h1>
        <div className="mt-2 space-y-1 text-sm text-charcoal">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-charcoal-muted" />
            <span>{formatMeetupDate(m.date)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-charcoal-muted" />
            <span>
              {formatMeetupTimeRange(m.start_time, m.end_time)}

            </span>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-charcoal-muted mt-0.5" />
            <span>
              {locationName}
              {address && (
                <span className="text-charcoal-muted"> · {address}</span>
              )}
            </span>
          </div>
          {summary.host && (
            <div className="flex items-center gap-2 pt-1">
              <UserAvatar name={summary.host.display_name} src={summary.host.avatar_url} size="sm" />
              <span className="text-sm text-charcoal-muted">
                Hosted by {summary.host.display_name}
              </span>
            </div>
          )}
        </div>
        {m.has_ended && summary.attendance_status !== "removed" && summary.meetup.status !== "cancelled" && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-soft-green text-primary font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {attendanceLine}
          </div>
        )}
      </div>
    </Card>
  );
}

function VerifiedSection({ summary }: { summary: MyMeetupSummary }) {
  const navigate = useNavigate();
  const list = summary.verified_connections ?? [];
  if (list.length === 0) {
    return (
      <Card padding="lg" className="text-center">
        <div className="mx-auto w-12 h-12 rounded-card bg-soft-green text-primary flex items-center justify-center">
          <Leaf className="w-5 h-5" />
        </div>
        <h3 className="mt-3 font-semibold text-charcoal">
          No Verified Connections from this Meetup.
        </h3>
        <p className="mt-1 text-sm text-charcoal-muted">
          You can still stay connected with people already in your Veggie Network.
        </p>
        <div className="mt-4">
          <SecondaryButton size="sm" onClick={() => navigate("/network")}>
            View Veggie Network
          </SecondaryButton>
        </div>
      </Card>
    );
  }
  return (
    <div>
      <h2 className="px-1 mb-2 text-base font-semibold text-charcoal">
        Veggies you met
      </h2>
      <div className="space-y-2">
        {list.map((p) => (
          <Card key={p.id} padding="md" className="flex items-center gap-3">
            <UserAvatar name={p.display_name} src={p.avatar_url} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-charcoal truncate">
                  {p.display_name.split(" ")[0]}
                </span>
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-soft-green text-primary">
                  <Leaf className="w-2.5 h-2.5" /> Verified
                </span>
              </div>
              {p.interests && p.interests[0] && (
                <div className="text-xs text-charcoal-muted mt-0.5 capitalize">
                  Likes {p.interests[0]}
                </div>
              )}
            </div>
            <button
              aria-label={`Message ${p.display_name}`}
              onClick={() => navigate(`/dm/user/${p.id}`)}
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
            <button
              aria-label={`View ${p.display_name}'s profile`}
              onClick={() => navigate(`/veggie/${p.id}`)}
              className="w-9 h-9 rounded-full bg-muted text-charcoal flex items-center justify-center"
            >
              <UserRound className="w-4 h-4" />
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CommunityImpactCard({ summary }: { summary: MyMeetupSummary }) {
  const navigate = useNavigate();
  const met = summary.verified_connections?.length ?? 0;
  const supported = !!summary.place;
  return (
    <Card padding="lg">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-charcoal">Community Impact</h3>
      </div>
      <ul className="mt-2 space-y-1.5 text-sm text-charcoal">
        <li>
          {met === 0
            ? "You attended a real-world Meetup."
            : met === 1
              ? "You met 1 Veggie in real life."
              : `You met ${met} Veggies in real life.`}
        </li>
        {supported && summary.place && (
          <li className="flex items-center justify-between gap-2">
            <span>You supported {summary.place.name}.</span>
            <button
              onClick={() => navigate(`/place/${summary.place!.id}`)}
              className="text-xs font-semibold text-primary"
            >
              View Place
            </button>
          </li>
        )}
      </ul>
    </Card>
  );
}

function ReflectionCard({
  summary,
  onSubmitted,
}: {
  summary: MyMeetupSummary;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(
    summary.feedback?.rating ?? null,
  );
  const [note, setNote] = useState(summary.feedback?.private_note ?? "");
  const [editing, setEditing] = useState(!summary.feedback);
  const submitted = !!summary.feedback && !editing;
  const canSubmit =
    summary.attendance_status === "checked_in" ||
    summary.attendance_status === "attended";

  const mutation = useMutation({
    mutationFn: async () => {
      if (!rating) throw new Error("Pick an option first.");
      await submitMeetupFeedback(summary.meetup.id, rating, note.trim() || null);
    },
    onSuccess: () => {
      toast.success("Thanks for sharing", {
        description: "Your feedback helps make VeggieMeet Meetups better.",
      });
      setEditing(false);
      onSubmitted();
    },
    onError: (e: Error) => toast.error(memberSafeMessage(e)),
  });

  if (!canSubmit) return null;

  return (
    <Card padding="lg">
      <h3 className="text-sm font-semibold text-charcoal">
        How was this Meetup?
      </h3>
      <p className="mt-1 text-xs text-charcoal-muted">
        Your response is private and helps improve future Meetups.
      </p>

      {submitted ? (
        <div className="mt-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-soft-green text-primary font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Feedback submitted
          </div>
          <div className="mt-3">
            <SecondaryButton size="sm" onClick={() => setEditing(true)}>
              Edit Feedback
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {RATING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRating(opt.value)}
                aria-pressed={rating === opt.value}
                className={cn(
                  "w-full text-left rounded-card border p-3 transition-colors",
                  rating === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/60",
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                      rating === opt.value
                        ? "border-primary bg-primary"
                        : "border-border",
                    )}
                    aria-hidden
                  >
                    {rating === opt.value && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-charcoal">
                    {opt.label}
                  </span>
                </div>
                <div className="mt-1 pl-6 text-xs text-charcoal-muted">
                  {opt.hint}
                </div>
              </button>
            ))}
          </div>

          <label className="block mt-4">
            <span className="text-xs font-medium text-charcoal">
              Anything else you'd like us to know?{" "}
              <span className="text-charcoal-muted font-normal">Optional</span>
            </span>
            <textarea
              aria-label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Private note to the VeggieMeet team"
              className="mt-1 w-full rounded-card border border-border p-3 text-sm text-charcoal bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
            <div className="mt-1 text-[11px] text-charcoal-muted text-right">
              {note.length}/500
            </div>
          </label>

          <div className="mt-3 flex gap-2">
            <PrimaryButton
              fullWidth
              disabled={!rating || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Submitting…" : "Submit Feedback"}
            </PrimaryButton>
            {summary.feedback && (
              <SecondaryButton onClick={() => setEditing(false)}>
                Cancel
              </SecondaryButton>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function HostSection({
  loading,
  data,
}: {
  loading: boolean;
  data: import("@/lib/postMeetup").HostMeetupSummary | undefined;
}) {
  if (loading || !data) {
    return <Card className="h-40 animate-pulse" />;
  }
  const rate = data.attendance_rate;
  return (
    <div className="space-y-4">
      <Card padding="lg">
        <h2 className="text-sm font-semibold text-charcoal">Attendance</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label="Confirmed" value={data.confirmed_count} />
          <Metric label="Checked in" value={data.checked_in_count} />
          <Metric label="Attendance" value={rate === null ? "—" : `${rate}%`} />
        </div>
      </Card>

      <Card padding="lg">
        <div className="flex items-center gap-2">
          <Leaf className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-charcoal">
            Verified Connections created
          </h2>
        </div>
        <div className="mt-2 text-3xl font-semibold text-charcoal">
          {data.verified_connections_count}
        </div>
        <p className="mt-1 text-xs text-charcoal-muted">
          Total unique pairs verified at this Meetup. Individual pairs are private.
        </p>
      </Card>

      <Card padding="lg">
        <h2 className="text-sm font-semibold text-charcoal">Attendee feedback</h2>
        {data.feedback.total === 0 ? (
          <p className="mt-2 text-sm text-charcoal-muted">No feedback yet.</p>
        ) : !data.feedback.threshold_met ? (
          <p className="mt-2 text-sm text-charcoal-muted">
            Not enough responses to display a summary yet. ({data.feedback.total} so far)
          </p>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            <FeedbackRow label="Great experience" value={data.feedback.great!} />
            <FeedbackRow label="It was okay" value={data.feedback.okay!} />
            <FeedbackRow label="Not for me" value={data.feedback.not_for_me!} />
            <div className="pt-1 text-xs text-charcoal-muted">
              Responses: {data.feedback.total}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xl font-semibold text-charcoal">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-charcoal-muted">
        {label}
      </div>
    </div>
  );
}

function FeedbackRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-charcoal">{label}</span>
      <span className="font-semibold text-charcoal">{value}</span>
    </div>
  );
}

function NotYetCard() {
  return (
    <Card padding="lg" className="text-center">
      <Clock className="w-6 h-6 mx-auto text-charcoal-muted" />
      <h3 className="mt-2 font-semibold text-charcoal">
        This Meetup hasn't ended yet.
      </h3>
      <p className="mt-1 text-sm text-charcoal-muted">
        Your summary will be ready once the Meetup wraps up.
      </p>
    </Card>
  );
}

function CancelledCard({ meetupId: _meetupId }: { meetupId: string }) {
  return (
    <Card padding="lg" className="text-center">
      <XCircle className="w-6 h-6 mx-auto text-charcoal-muted" />
      <h3 className="mt-2 font-semibold text-charcoal">This Meetup was cancelled.</h3>
      <p className="mt-1 text-sm text-charcoal-muted">
        No reflection is available. You can still report a safety concern below.
      </p>
    </Card>
  );
}

function RemovedCard({ meetupId: _meetupId }: { meetupId: string }) {
  return (
    <Card padding="lg" className="text-center">
      <ShieldAlert className="w-6 h-6 mx-auto text-charcoal-muted" />
      <h3 className="mt-2 font-semibold text-charcoal">
        You were removed from this Meetup.
      </h3>
      <p className="mt-1 text-sm text-charcoal-muted">
        A post-Meetup summary is not available. You can still report a concern below.
      </p>
    </Card>
  );
}

function SafetyCard({
  meetupId,
  hostName: _hostName,
}: {
  meetupId: string;
  hostName: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card padding="md">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-charcoal-muted" />
        <h3 className="text-sm font-semibold text-charcoal">Need support?</h3>
      </div>
      <p className="mt-1 text-xs text-charcoal-muted">
        Reports are private. The host is not notified.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setOpen(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-muted text-charcoal hover:bg-muted/80"
        >
          Report a safety concern
        </button>
      </div>
      <ReportMeetupDialog meetupId={meetupId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}


