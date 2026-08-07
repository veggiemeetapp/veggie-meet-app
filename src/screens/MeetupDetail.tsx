import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Flag, MessageCircle, MoreVertical, QrCode, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportMeetupDialog } from "@/components/safety/ReportMeetupDialog";
import { PrimaryButton, SecondaryButton } from "@/components/app";
import {
  MeetupHero,
  MeetupInfo,
  MeetupPlaceSection,
  HostCard,
  AttendeePreview,
  WhatToExpect,
  MeetupDescription,
} from "@/components/meetup";
import { MeetupCheckInButton } from "@/components/meetup/MeetupCheckInButton";

import { getMeetup, getPlace, getVeggie, veggies } from "@/lib/mock-data";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureChatMembership,
  fetchMeetupById,
  fetchMyRemovalDetails,
  fetchProfileAsVeggie,
  getMeetupRole,
  isUuid,
  type MeetupRole,
} from "@/lib/backend";
import { fetchMeetupLifecycle, lifecycleLabel } from "@/lib/meetupLifecycle";
import { useAuth } from "@/hooks/useAuth";
import type { Meetup, Veggie } from "@/types";



function mockDistance(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 0.3 + (h % 45) / 10;
}

const friendlyDescription = (title: string) =>
  `Come as you are. ${title} is a low-key gathering built around great plant-based food and easy conversation. Whether you're brand new to plant-based living or a lifelong veggie, you'll find kind people, a warm welcome, and a table that feels like home.\n\nWe'll keep the group small so everyone gets a chance to connect. No pressure, no performance — just a good evening out with your kind of people.`;

type MembershipResult = { meetup: Meetup | null; role: MeetupRole };

function RemovedBanner({ meetupId }: { meetupId: string }) {
  const { data } = useQuery({
    queryKey: ["my-removal", meetupId],
    queryFn: () => fetchMyRemovalDetails(meetupId),
    staleTime: 0,
  });
  return (
    <div className="rounded-2xl border border-border bg-muted p-4 text-center">
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
        chatId = (await ensureChatMembership(profile.id, m.id)) ?? "";
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

  // Mock (non-uuid) meetups: resolve synchronously.
  const mockMeetup = !isRealMeetup && id ? getMeetup(id) ?? null : null;

  const meetup: Meetup | null | undefined = isRealMeetup
    ? membershipQuery.data?.meetup
    : mockMeetup;
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
        <div className="safe-top flex items-center px-4 pt-3 pb-2">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
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

  const host = getVeggie(meetup.hostId) ?? dbHost ?? undefined;
  const place = getPlace(meetup.communityPlaceId);
  const attendeeList = meetup.attendeeIds
    .map((i) => veggies.find((v) => v.id === i))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const description = meetup.description?.trim().length
    ? `${meetup.description}\n\n${friendlyDescription(meetup.title)}`
    : friendlyDescription(meetup.title);

  return (
    <div className="pb-32">
      <MeetupHero
        imageUrl={meetup.coverImageUrl}
        title={meetup.title}
        extraAction={
          isRealMeetup ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
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
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-charcoal">Location not set yet.</p>
            <p className="mt-1 text-xs text-charcoal-muted">
              The host hasn't confirmed a place. Joining is paused until the location is set —
              you'll be notified as soon as it's ready.
            </p>
          </div>
        ) : meetup.location?.isInferred ? (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <p className="text-sm font-semibold text-charcoal">Location is approximate.</p>
            <p className="mt-1 text-xs text-charcoal-muted">
              The host set the city but hasn't confirmed the exact place yet. Details may change
              — we'll notify you if they do.
            </p>
          </div>
        ) : null}

        <MeetupInfo meetup={meetup} place={place} distanceKm={mockDistance(meetup.id)} />

        {isRealMeetup && <MeetupPlaceSection meetupId={meetup.id} />}


        {host && <HostCard host={host} />}

        <AttendeePreview
          attendees={attendeeList}
          totalCount={meetup.attendeeIds.length}
          capacity={meetup.capacity}
          meetupId={meetup.id}
        />

        <MeetupDescription description={description} />

        <WhatToExpect />
      </div>

      <div className="fixed bottom-0 inset-x-0 mx-auto max-w-phone bg-background/95 backdrop-blur-xl border-t border-border safe-bottom">
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
                  endsAt={`${meetup.date}T${meetup.endTime}`}
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
          onOpenChange={setReportOpen}
        />
      )}
    </div>
  );
}

