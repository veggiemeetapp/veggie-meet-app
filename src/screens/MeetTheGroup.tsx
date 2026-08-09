import { safeBack } from "@/lib/navigation";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { AppHeader, PrimaryButton, SecondaryButton } from "@/components/app";
import { AttendeeCard } from "@/components/group/AttendeeCard";
import { getMeetup, getVeggie } from "@/lib/mock-data";

export default function MeetTheGroup() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meetup = id ? getMeetup(id) : undefined;

  if (!meetup) {
    return (
      <div className="flex flex-col min-h-dvh">
        <AppHeader
          title="Meet the Group"
          left={
            <button
              onClick={() => safeBack(navigate, "/plans")}
              aria-label="Back"
              className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          }
        />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">We couldn't find this group.</p>
          <p className="text-sm text-charcoal-muted">
            The meetup may have ended or been removed.
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

  const host = getVeggie(meetup.hostId);
  const attendees = meetup.attendeeIds
    .filter((aid) => aid !== meetup.hostId)
    .map((aid) => getVeggie(aid))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  return (
    <div className="flex flex-col min-h-dvh">
      <AppHeader
        left={
          <button
            onClick={() => safeBack(navigate, "/plans")}
            aria-label="Back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        }
      />

      <div className="px-5 pt-2 pb-4">
        <h1 className="text-[26px] font-semibold text-charcoal tracking-tight leading-tight">
          Meet the Group
        </h1>
        <p className="mt-2 text-charcoal-muted leading-relaxed">
          Get to know who's joining before you arrive.
        </p>
      </div>

      <div className="px-5 pb-4 space-y-3">
        {host && <AttendeeCard veggie={host} isHost />}
        {attendees.map((v) => (
          <AttendeeCard key={v.id} veggie={v} showConnect />
        ))}
      </div>

      <div className="mt-auto safe-bottom sticky bottom-0 bg-background/95 backdrop-blur-md border-t border-border/60 px-5 pt-3 pb-4 flex flex-col gap-2">
        <Link to={`/chat/${meetup.chatId}`}>
          <PrimaryButton fullWidth>
            <MessageCircle className="w-4 h-4" />
            Continue to Meetup Chat
          </PrimaryButton>
        </Link>
        <SecondaryButton fullWidth size="sm" onClick={() => safeBack(navigate, "/plans")}>
          Back
        </SecondaryButton>
      </div>
    </div>
  );
}
