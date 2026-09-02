import { safeBack } from "@/lib/navigation";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, MessageCircle, MoreVertical, QrCode, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportMeetupDialog } from "@/components/safety/ReportMeetupDialog";
import { PrimaryButton, SecondaryButton, BackButton } from "@/components/app";
import {
  MeetupHero,
  MeetupInfo,
  MeetupPlaceSection,
  HostCard,
  AttendeePreview,
  MeetupDescription,
  MeetupInterestTags,
  AddToGoogleCalendarButton,
} from "@/components/meetup";

import { MeetupCheckInButton } from "@/components/meetup/MeetupCheckInButton";
import { InvitationNote } from "@/components/invitations/InvitationNote";


import { supabase } from "@/integrations/supabase/client";
import {
  resolveMeetupChatId,
  fetchMeetupById,
  fetchMyRemovalDetails,
  fetchProfileAsVeggie,
  getMeetupRole,
  isUuid,
  type MeetupRole,
} from "@/lib/backend";
import { fetchMeetupLifecycle, lifecycleLabel } from "@/lib/meetupLifecycle";
import { meetupShareUrl } from "@/lib/share";

import { useAuth } from "@/hooks/useAuth";
import { useStickyPanelHeight } from "@/hooks/useStickyPanelHeight";

import type { Meetup, Veggie } from "@/types";



// WO-095 DEF-095-02: this file used to synthesise a distance from a hash of the
// meetup id and render it as "N km away", and DEF-095-03: it appended canned
// marketing prose to every host's description. Both fabricated content, so both
// are gone — the screen now shows only what the host and the server provide.

type MembershipResult = { meetup: Meetup | null; role: MeetupRole };

function RemovedBanner({ meetupId }: { meetupId: string }) {
  const { data } = useQuery({
    queryKey: ["my-removal", meetupId],
    queryFn: () => fetchMyRemovalDetails(meetupId),
    staleTime: 0,
  });
  return (
    <div className="rounded-card border border-border bg-muted p-4 text-center">
      <p className="text-sm font-semibold text-charcoal">
        You're no longer attending this Meetup.
      </p>
      {data?.reason && (
        <p className="mt-1 text-xs text-charcoal-muted">Host note: {data.reason}</p>
      )}
    </div>
  );
}

export default function MeetupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [dbHost, setDbHost] = useState<Veggie | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // WO-140 DEF-140-01: the report dialog is opened from a dropdown item that
  // unmounts, so Radix has no element to return focus to. Restore focus to the
  // Meetup options button whenever the dialog closes (submit, Cancel, Escape).
  const reportTriggerRef = useRef<HTMLButtonElement>(null);
  // WO-130 DEF-130-01: the action panel height varies by role/state and text
  // scaling, so content clearance is measured instead of hard-coded.
  const { ref: panelRef, height: panelHeight } = useStickyPanelHeight();


  const isRealMeetup = !!id && isUuid(id);

  // Backend-derived membership. Gated on auth so we never resolve to
  // "visitor" while the profile is still hydrating.
  const membershipQuery = useQuery<MembershipResult>({
    queryKey: ["meetup-membership", id, profile?.id ?? null],
    enabled: !!id && isRealMeetup && !authLoading,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      const m = await fetchMeetupById(id!);
      if (!m) return { meetup: null, role: "visitor" };
      const role = await getMeetupRole(profile?.id, m);
      // Repair: host/attendee should always have an openable chat.
      let chatId = m.chatId;
      if (role !== "visitor" && !chatId && profile?.id) {
        chatId = (await resolveMeetupChatId(m.id)) ?? "";
      }
      return { meetup: { ...m, chatId }, role };
    },
  });
  // WO-063 — server-authoritative lifecycle for calm historical states.
  const lifecycleQuery = useQuery({
    queryKey: ["meetup-lifecycle", id],
    enabled: !!id && isRealMeetup && !authLoading,
    queryFn: () => fetchMeetupLifecycle(id!),
  });


  // Also refetch when tab becomes visible (some browsers do not fire focus).
  useEffect(() => {
    if (!isRealMeetup) return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey: ["meetup-membership", id] });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [id, isRealMeetup, queryClient]);

  // Realtime: reflect host actions (remove / cancel) on the already-open screen
  // without requiring a refresh, focus change, or remount.
  useEffect(() => {
    if (!isRealMeetup || !id) return;
    const channel = supabase
      .channel(`meetup-detail:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance", filter: `meetup_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["meetup-membership", id] });
          queryClient.invalidateQueries({ queryKey: ["my-removal", id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meetups", filter: `id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["meetup-membership", id] });
        },
      )
      .subscribe((status) => {
        if (import.meta.env.DEV && status !== "SUBSCRIBED") {
          // eslint-disable-next-line no-console
          console.warn("[realtime] meetup-detail channel status", status);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, isRealMeetup, queryClient]);

  // WO-095: only server-backed (uuid) Meetups render. The screen used to fall
  // back to the mock-data fixture for non-uuid ids, which rendered fixture
  // people and places as if they were real.
  const meetup: Meetup | null | undefined = isRealMeetup
    ? membershipQuery.data?.meetup
    : null;
  const role: MeetupRole = isRealMeetup
    ? membershipQuery.data?.role ?? "visitor"
    : "visitor";

  const lifecycleState = lifecycleQuery.data?.lifecycle_state ?? null;
  const isHistorical =
    lifecycleState === "ended" ||
    lifecycleState === "completed" ||
    lifecycleState === "cancelled";



  // Resolve backend host profile for display (mock hosts resolve locally).
  useEffect(() => {
    if (!meetup || !isUuid(meetup.hostId)) return;
    let cancelled = false;
    fetchProfileAsVeggie(meetup.hostId).then((v) => {
      if (!cancelled) setDbHost(v);
    });
    return () => {
      cancelled = true;
    };
  }, [meetup?.hostId]);

  // While auth or the membership query is still resolving for a real meetup,
  // treat the state as "loading" rather than showing an incorrect CTA.
  const membershipLoading =
    isRealMeetup && (authLoading || membershipQuery.isPending || membershipQuery.isFetching && !membershipQuery.data);

  if (membershipLoading || (isRealMeetup && meetup === undefined)) {
    return (
      <div className="flex flex-col min-h-dvh items-center justify-center text-sm text-charcoal-muted">
        Loading…
      </div>
    );
  }


  if (!meetup) {
    return (
      <div className="flex flex-col min-h-dvh">
        <div className="safe-top flex items-center page-x pt-3 pb-2">
          <BackButton fallback="/community" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">This meetup isn't available.</p>
          <p className="text-sm text-charcoal-muted">
            It may have ended or been removed.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-4 text-sm font-semibold text-primary"
          >
            Back to Today
          </button>
        </div>
      </div>
    );
  }

  const host = dbHost ?? undefined;
  const attendeeList: never[] = [];
  const description = meetup.description?.trim().length
    ? meetup.description.trim()
    : "The host hasn’t added a description yet.";

  // WO-130: reserve exactly the sticky panel's measured height (which already
  // includes its safe-area padding) plus one spacing token, so the last line of
  // content rests above the panel without a large empty gap.
  const contentClearance = panelHeight
    ? `calc(${panelHeight}px + 1rem)`
    : "calc(8rem + env(safe-area-inset-bottom))";

  return (
    <div style={{ paddingBottom: contentClearance }}>

      <MeetupHero
        imageUrl={meetup.coverImageUrl}
        title={meetup.title}
        shareUrl={isRealMeetup ? meetupShareUrl(meetup.id) : undefined}
        shareMeta={{ meetup_id: meetup.id }}

        extraAction={
          isRealMeetup ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  ref={reportTriggerRef}
                  type="button"
                  aria-label="Meetup options"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-charcoal"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => setReportOpen(true)}>
                  <Flag className="w-4 h-4 mr-2" />
                  Report Meetup
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      <div className="px-5 pt-5 space-y-8">
        {isHistorical ? null : meetup.location?.locationSource === "unknown" ? (
          <div className="rounded-card border border-warning/40 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-charcoal">Location not set yet.</p>
            <p className="mt-1 text-xs text-charcoal-muted">
              The host hasn't confirmed a place. Joining is paused until the location is set —
              you'll be notified as soon as it's ready.
            </p>
          </div>
        ) : meetup.location?.isInferred ? (
          <div className="rounded-card border border-warning/40 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-charcoal">Location is approximate.</p>
            <p className="mt-1 text-xs text-charcoal-muted">
              The host set the city but hasn't confirmed the exact place yet. Details may change
              — we'll notify you if they do.
            </p>
          </div>
        ) : null}

        {/* WO-144A addendum — private invitation note for the recipient only. */}
        {isRealMeetup && !isHistorical && (
          <InvitationNote meetupId={meetup.id} viewerProfileId={profile?.id} />
        )}

        <MeetupInfo meetup={meetup} />

        {isRealMeetup && <MeetupPlaceSection meetupId={meetup.id} />}


        {/* WO-125 — read-only interest tags, after the essentials, before the story. */}
        <MeetupInterestTags
          primaryInterestId={meetup.primaryInterestId}
          additionalInterestIds={meetup.additionalInterestIds}
        />




        {host && <HostCard host={host} />}

        <AttendeePreview
          attendees={attendeeList}
          totalCount={meetup.attendeeIds.length}
          capacity={meetup.capacity}
          meetupId={meetup.id}
        />

        <MeetupDescription description={description} />
      </div>

      <div
        ref={panelRef}
        data-testid="meetup-action-panel"
        className="fixed bottom-0 inset-x-0 mx-auto max-w-phone bg-background/95 backdrop-blur-xl border-t border-border safe-bottom z-30"
      >
        <div className="px-5 py-4 flex flex-col gap-2">
          {isHistorical ? (
            <>
              <div className="text-center text-sm font-semibold text-charcoal">
                {lifecycleLabel(lifecycleState!)}
              </div>
              {role !== "visitor" && meetup.chatId && (
                <Link
                  to={`/chat/${meetup.chatId}`}
                  className="text-center text-sm font-semibold text-primary py-1"
                >
                  Open meetup chat
                </Link>
              )}
            </>
          ) : (
          <>

          {role === "host" && (
            <>
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
                <Check className="w-4 h-4" />
                You're hosting this meetup
              </div>
              {meetup.chatId ? (
                <Link to={`/chat/${meetup.chatId}`}>
                  <PrimaryButton fullWidth>
                    <MessageCircle className="w-4 h-4" />
                    Open meetup chat
                  </PrimaryButton>
                </Link>
              ) : (
                <PrimaryButton fullWidth disabled>
                  Open meetup chat
                </PrimaryButton>
              )}
              <Link
                to={`/checkin/${meetup.id}`}
                className="text-center text-sm font-semibold text-primary py-1 inline-flex items-center justify-center gap-1"
              >
                <QrCode className="w-4 h-4" /> Check in with Veggies
              </Link>
              {/* WO-117: hosts export their own Meetup without RSVPing. */}
              <AddToGoogleCalendarButton meetup={meetup} surface="meetup_detail" />
              <Link
                to={`/meetup/${meetup.id}/manage`}
                className="text-center text-sm font-semibold text-charcoal py-1 inline-flex items-center justify-center gap-1"
              >
                <Settings className="w-4 h-4" /> Manage Meetup
              </Link>

            </>
          )}

          {role === "attendee" && (
            <>
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
                <Check className="w-4 h-4" />
                You're going
              </div>
              {isRealMeetup && profile?.id && (
                <MeetupCheckInButton
                  meetupId={meetup.id}
                  profileId={profile.id}
                  startsAt={`${meetup.date}T${meetup.startTime}`}
                  endsAt={`${meetup.date}T${meetup.endTime ?? meetup.startTime}`}
                />
              )}

              {meetup.chatId ? (

                <Link to={`/chat/${meetup.chatId}`}>
                  <PrimaryButton fullWidth>
                    <MessageCircle className="w-4 h-4" />
                    Open meetup chat
                  </PrimaryButton>
                </Link>
              ) : (
                <SecondaryButton fullWidth disabled>
                  Open meetup chat
                </SecondaryButton>
              )}
              <Link
                to={`/checkin/${meetup.id}`}
                className="text-center text-sm font-semibold text-primary py-1 inline-flex items-center justify-center gap-1"
              >
                <QrCode className="w-4 h-4" /> Check in with Veggies
              </Link>
              {/* WO-117: persistent calendar export for already-joined members. */}
              <AddToGoogleCalendarButton meetup={meetup} surface="meetup_detail" />

            </>
          )}

          {role === "visitor" && (
            <>
              {meetup.location?.locationSource === "unknown" ? (
                <PrimaryButton fullWidth disabled>
                  Join paused — location not set
                </PrimaryButton>
              ) : (
                <Link to={`/join/${meetup.id}`}>
                  <PrimaryButton fullWidth>Join meetup</PrimaryButton>
                </Link>
              )}
              {meetup.chatId && (
                <Link
                  to={`/chat/${meetup.chatId}`}
                  className="text-center text-sm font-semibold text-primary py-1"
                >
                  Open meetup chat
                </Link>
              )}
            </>
          )}


          {role === "removed" && <RemovedBanner meetupId={meetup.id} />}
          </>
          )}
        </div>
      </div>

      {isRealMeetup && (
        <ReportMeetupDialog
          meetupId={meetup.id}
          open={reportOpen}
          onOpenChange={(next) => {
            setReportOpen(next);
            if (!next) {
              // Defer past Radix's own close/unmount focus handling.
              setTimeout(() => reportTriggerRef.current?.focus(), 0);
            }
          }}
        />
      )}
    </div>
  );
}

