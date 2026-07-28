import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  Check,
  ChevronRight,
  Clock,
  MapPin,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { Card, PrimaryButton, SecondaryButton, UserAvatar } from "@/components/app";
import {
  acknowledgeMeetupUpdate,
  declineMeetupInvitation,
  formatPlanDate,
  formatPlanTime,
  formatPlanTimeRange,
  leaveMeetup,
  planLocationLabel,
  type PlanItem,
} from "@/lib/plans";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { joinFromInvitation } from "@/lib/invitations";
import { fallbackCover } from "@/lib/invitations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  plan: PlanItem;
  onChanged?: () => void;
  variant?: "default" | "attention";
}

const REASON_TONE: Record<string, string> = {
  active: "bg-primary/10 text-primary",
  update: "bg-amber-100 text-amber-900",
  cancelled: "bg-muted text-charcoal-muted",
  invitation: "bg-purple-100 text-purple-900",
  hosting: "bg-emerald-100 text-emerald-900",
  upcoming: "bg-sky-100 text-sky-900",
  follow_up: "bg-rose-100 text-rose-900",
  past: "bg-muted text-charcoal-muted",
};

export function PlanCard({ plan, onChanged, variant = "default" }: Props) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const openMeetup = async () => {
    if (plan.has_unseen_update) await acknowledgeMeetupUpdate(plan.meetup_id).catch(() => {});
    navigate(`/meetup/${plan.meetup_id}`);
    onChanged?.();
  };

  const primary = async () => {
    switch (plan.primary_action) {
      case "check_in":
        navigate(`/checkin/${plan.meetup_id}`);
        return;
      case "open_chat":
        navigate(`/chat/${plan.meetup_id}`);
        return;
      case "manage_meetup":
        navigate(`/meetup/${plan.meetup_id}/manage`);
        return;
      case "review_invitation":
      case "view_meetup":
        return openMeetup();
      case "view_summary":
        navigate(`/meetup/${plan.meetup_id}/summary`);
        return;
    }
  };

  const acceptInvitation = async () => {
    if (!plan.invitation) return;
    setBusy(true);
    try {
      await joinFromInvitation(plan.invitation.id);
      toast.success("You're going!");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept");
    } finally {
      setBusy(false);
    }
  };

  const doDecline = async () => {
    if (!plan.invitation) return;
    setBusy(true);
    try {
      await declineMeetupInvitation(plan.invitation.id);
      toast.success("Invitation declined");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not decline");
    } finally {
      setBusy(false);
      setConfirmDecline(false);
    }
  };

  const doLeave = async () => {
    setBusy(true);
    try {
      await leaveMeetup(plan.meetup_id);
      toast.success("You left the Meetup");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not leave");
    } finally {
      setBusy(false);
      setConfirmLeave(false);
    }
  };

  const primaryLabel = ((): string => {
    switch (plan.primary_action) {
      case "check_in":
        return "Check In";
      case "open_chat":
        return "Open Chat";
      case "manage_meetup":
        return "Manage Meetup";
      case "review_invitation":
        return "Review invitation";
      case "view_summary":
        return "View Summary";
      case "view_meetup":
      default:
        return "View Meetup";
    }
  })();

  const showAcceptDecline = plan.plan_type === "invitation";
  const showLeave =
    (plan.plan_type === "upcoming" || plan.plan_type === "active") && plan.role !== "host";

  return (
    <>
      <Card padding="none" className={cn("overflow-hidden", variant === "attention" && "ring-1 ring-primary/30")}> 
        <div className="flex gap-3 p-3">
          {plan.image ? (
            <img
              src={fallbackCover(plan.image)}
              alt=""
              className="w-16 h-16 rounded-xl object-cover flex-none"
              loading="lazy"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-muted flex-none" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {plan.reason_label && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
                      REASON_TONE[plan.reason_code] ?? "bg-muted text-charcoal-muted",
                    )}
                  >
                    {plan.has_unseen_update && plan.plan_type === "update" && (
                      <span aria-hidden>•</span>
                    )}
                    {plan.reason_label}
                  </span>
                )}
                <h3 className="mt-1 font-semibold text-charcoal truncate">
                  {plan.title}
                </h3>
              </div>
              {(showLeave || showAcceptDecline) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More actions"
                      className="min-w-11 min-h-11 w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-charcoal-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={openMeetup}>View Meetup</DropdownMenuItem>
                    {plan.plan_type !== "invitation" && (
                      <DropdownMenuItem onClick={() => navigate(`/chat/${plan.meetup_id}`)}>
                        Open Chat
                      </DropdownMenuItem>
                    )}
                    {showLeave && (
                      <DropdownMenuItem onClick={() => setConfirmLeave(true)}>
                        Leave Meetup
                      </DropdownMenuItem>
                    )}
                    {showAcceptDecline && (
                      <DropdownMenuItem onClick={() => setConfirmDecline(true)}>
                        Decline invitation
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <dl className="mt-1.5 space-y-1 text-xs text-charcoal-muted">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" aria-hidden />
                <span>{formatPlanDate(plan)}</span>
                <span aria-hidden>·</span>
                <Clock className="w-3.5 h-3.5" aria-hidden />
                <span>
                  {plan.plan_type === "active"
                    ? formatPlanTimeRange(plan)
                    : formatPlanTime(plan)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 truncate">
                <MapPin className="w-3.5 h-3.5 flex-none" aria-hidden />
                <span className="truncate">{planLocationLabel(plan)}</span>
              </div>
              {plan.role === "host" && (
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" aria-hidden />
                  <span>
                    {plan.attendee_count}/{plan.capacity} going
                  </span>
                </div>
              )}
              {plan.role !== "host" && (
                <div className="flex items-center gap-1.5 truncate">
                  <UserAvatar
                    name={plan.host.name}
                    src={plan.host.avatar ?? undefined}
                    size="xs"
                  />
                  <span className="truncate">Hosted by {plan.host.name}</span>
                </div>
              )}
            </dl>
          </div>
        </div>

        <div className="px-3 pb-3">
          {showAcceptDecline ? (
            <div className="flex gap-2">
              <PrimaryButton
                size="sm"
                fullWidth
                onClick={acceptInvitation}
                disabled={busy}
              >
                <Check className="w-4 h-4" /> Accept
              </PrimaryButton>
              <SecondaryButton size="sm" onClick={openMeetup} disabled={busy}>
                Details
              </SecondaryButton>
            </div>
          ) : (
            <PrimaryButton
              size="sm"
              fullWidth
              onClick={primary}
              disabled={busy || plan.plan_type === "cancelled"}
            >
              {plan.plan_type === "cancelled" ? "View details" : primaryLabel}
              <ChevronRight className="w-4 h-4" />
            </PrimaryButton>
          )}
        </div>
      </Card>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this Meetup?</AlertDialogTitle>
            <AlertDialogDescription>
              Your spot will become available to someone else.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Stay</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={doLeave}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDecline} onOpenChange={setConfirmDecline}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The host won't be notified specifically. You can still find this Meetup through Search.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={doDecline}>
              Decline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
