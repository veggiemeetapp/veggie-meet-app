import { safeBack } from "@/lib/navigation";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { AppHeader, PrimaryButton, SecondaryButton, UserAvatar, BackButton } from "@/components/app";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isUuid } from "@/lib/backend";
import { formatMeetupDate, formatMeetupTimeRange } from "@/lib/format";

type GroupMember = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  current_city: string | null;
  interests: string[];
  is_you: boolean;
  is_available: boolean;
};

type GroupPayload = {
  found: boolean;
  meetup?: {
    id: string;
    title: string;
    date: string;
    start_time: string;
    end_time: string | null;
    location_name: string | null;
    address: string | null;
    chat_id: string | null;
    is_host: boolean;
  };
  host?: GroupMember;
  attendees?: GroupMember[];
};

/**
 * WO-088 DEF-088-01 — Meet the Group.
 *
 * This screen used to read the mock-data fixture, so every real Meetup rendered
 * "We couldn't find this group". It now reads the server-authoritative
 * `get_meetup_group` RPC: members only, no coordinates, blocked members
 * suppressed and deleted members anonymised by the server.
 */
export default function MeetTheGroup() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const isReal = !!id && isUuid(id);

  const { data, isPending, isError, refetch } = useQuery<GroupPayload>({
    queryKey: ["meetup-group", id, profile?.id ?? null],
    enabled: isReal && !authLoading,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_meetup_group", {
        _meetup_id: id,
      });
      if (error) throw error;
      return (data ?? { found: false }) as GroupPayload;
    },
  });

  const header = (
    <AppHeader
      title="Meet the Group"
      left={
        <BackButton fallback="/plans" />
      }
    />
  );

  if (isReal && (authLoading || isPending)) {
    return (
      <div className="flex flex-col min-h-dvh">
        {header}
        <div className="px-5 py-6 space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-card bg-muted/60 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col min-h-dvh">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">We couldn't load this group.</p>
          <p className="text-sm text-charcoal-muted">Check your connection and try again.</p>
          <PrimaryButton className="mt-4" onClick={() => refetch()}>
            Try again
          </PrimaryButton>
        </div>
      </div>
    );
  }

  if (!isReal || !data?.found || !data.meetup) {
    return (
      <div className="flex flex-col min-h-dvh">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">This group isn't available.</p>
          <p className="text-sm text-charcoal-muted">
            The group is only visible to Veggies going to this Meetup.
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

  const { meetup, host, attendees = [] } = data;

  return (
    <div className="flex flex-col min-h-dvh">
      {header}

      <div className="px-5 pt-4 pb-28 space-y-6">
        <section className="rounded-card border border-border bg-card p-4">
          <h2 className="font-semibold text-charcoal [overflow-wrap:anywhere]">{meetup.title}</h2>
          <p className="mt-1 text-sm text-charcoal-muted">
            {formatMeetupDate(meetup.date)} ·{" "}
            {formatMeetupTimeRange(meetup.start_time, meetup.end_time)}
          </p>
          {meetup.location_name && (
            <p className="mt-1 text-sm text-charcoal-muted [overflow-wrap:anywhere]">
              {meetup.location_name}
              {meetup.address ? ` · ${meetup.address}` : ""}
            </p>
          )}
        </section>

        {host && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
              Host
            </h3>
            <MemberRow member={host} />
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-charcoal-muted mb-2">
            Going ({attendees.length})
          </h3>
          {attendees.length === 0 ? (
            <p className="text-sm text-charcoal-muted">
              No one else has joined yet. You'll see them here as they do.
            </p>
          ) : (
            <ul className="space-y-2">
              {attendees.map((m) => (
                <li key={m.id}>
                  <MemberRow member={m} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="fixed bottom-0 inset-x-0 mx-auto max-w-phone bg-background/95 backdrop-blur-xl border-t border-border safe-bottom">
        <div className="px-5 py-4 space-y-2">
          {meetup.chat_id && (
            <Link to={`/chat/${meetup.chat_id}`}>
              <PrimaryButton fullWidth>
                <MessageCircle className="w-4 h-4" aria-hidden /> Open meetup chat
              </PrimaryButton>
            </Link>
          )}
          <SecondaryButton fullWidth onClick={() => navigate(`/meetup/${meetup.id}`)}>
            View Meetup
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

function MemberRow({ member }: { member: GroupMember }) {
  const body = (
    <div className="flex items-center gap-3 rounded-card border border-border bg-card p-3.5">
      <UserAvatar name={member.display_name} src={member.avatar_url ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-charcoal [overflow-wrap:anywhere]">
          {member.display_name}
          {member.is_you && (
            <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-charcoal-muted">
              You
            </span>
          )}
        </div>
        {member.current_city && (
          <div className="text-xs text-charcoal-muted truncate">{member.current_city}</div>
        )}
        {member.interests.length > 0 && (
          <div className="mt-1 text-xs text-charcoal-muted truncate">
            {member.interests.slice(0, 3).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );

  // A suppressed (blocked) or deleted member is shown without a profile link.
  if (!member.is_available || member.is_you) return body;
  return (
    <Link to={`/veggie/${member.id}`} className="block">
      {body}
    </Link>
  );
}
