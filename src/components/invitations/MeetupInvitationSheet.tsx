import { memberSafeMessage } from "@/lib/errors";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  Clock,
  Loader2,
  MapPin,
  Send,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PrimaryButton, ProgressiveImage, SecondaryButton } from "@/components/app";
import { formatMeetupDate, formatTime12h } from "@/lib/format";
import {
  createInvitation,
  DEFAULT_INVITATION_MESSAGE,
  EligibleMeetup,
  fetchEligibleMeetups,
  PERSONAL_MESSAGE_MAX,
} from "@/lib/invitations";
import { useMeetupCategoryLabels } from "@/lib/meetupCategory";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { FALLBACK_COVER } from "@/lib/backend";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  senderProfileId: string;
  recipient: { profileId: string; firstName: string; displayName: string };
  /** Called after a successful send with the new invitation id. */
  onSent?: (invitationId: string) => void;
}

type Step = "select" | "review";

export function MeetupInvitationSheet({
  open,
  onOpenChange,
  senderProfileId,
  recipient,
  onSent,
}: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("select");
  const [meetups, setMeetups] = useState<EligibleMeetup[] | null>(null);
  // WO-126A — canonical Primary category labels for the eligible-Meetup list.
  const categoryLabels = useMeetupCategoryLabels(
    (meetups ?? []).map((m) => m.primaryInterestId),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState(DEFAULT_INVITATION_MESSAGE);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSelectedId(null);
    setMessage(DEFAULT_INVITATION_MESSAGE);
    setMeetups(null);
    setLoadError(null);
    fetchEligibleMeetups(senderProfileId, recipient.profileId)
      .then(setMeetups)
      .catch(() => setLoadError("Couldn't load your Meetups."));
  }, [open, senderProfileId, recipient.profileId]);

  const selected = useMemo(
    () => meetups?.find((m) => m.id === selectedId) ?? null,
    [meetups, selectedId],
  );

  const trimmed = message.trim();
  const canSend =
    !!selected && selected.eligible && trimmed.length > 0 &&
    trimmed.length <= PERSONAL_MESSAGE_MAX && !sending;

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    try {
      const id = await createInvitation(
        selected.id,
        recipient.profileId,
        trimmed,
      );
      toast.success(`Invitation sent to ${recipient.firstName}.`);
      onSent?.(id);
      onOpenChange(false);
    } catch (e) {
      const msg =
        memberSafeMessage(e);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle className="text-base">
            {step === "select"
              ? `Invite ${recipient.firstName} to a Meetup`
              : "Review invitation"}
          </DialogTitle>
          {step === "select" && (
            <DialogDescription className="text-xs">
              Choose an upcoming Meetup you're attending.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "select" && (
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            {meetups === null && !loadError ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-charcoal-muted" />
              </div>
            ) : loadError ? (
              <p className="text-sm text-destructive text-center py-6">
                {loadError}
              </p>
            ) : meetups && meetups.length === 0 ? (
              <NoEligibleState
                onExplore={() => {
                  onOpenChange(false);
                  navigate("/community");
                }}
              />
            ) : (
              <ul className="space-y-2">
                {meetups!.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={!m.eligible}
                      onClick={() => setSelectedId(m.id)}
                      className={cn(
                        "w-full text-left rounded-card border p-3 flex gap-3 transition-colors",
                        selectedId === m.id
                          ? "border-primary bg-soft-green/70"
                          : "border-border/70 bg-card",
                        m.eligible
                          ? "hover:bg-muted/50"
                          : "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <ProgressiveImage
                        src={m.coverImageUrl}
                        fallbackSrc={FALLBACK_COVER}
                        alt=""
                        containerClassName="w-16 h-16 rounded-control shrink-0"
                        loading="lazy"
                      />
                      <div className="min-w-0 flex-1">
                        {categoryLabels.labelFor(m.primaryInterestId, m.category) && (
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                            {categoryLabels.labelFor(m.primaryInterestId, m.category)}
                          </div>
                        )}
                        <div className="font-semibold text-charcoal text-sm leading-snug line-clamp-2">
                          {m.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-charcoal-muted">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatMeetupDate(m.date)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTime12h(m.startTime)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {m.attendeeCount}/{m.capacity}
                          </span>
                        </div>
                        {m.locationLabel && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-charcoal-muted truncate">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{m.locationLabel}</span>
                          </div>
                        )}
                        {!m.eligible && m.reason && (
                          <div className="mt-1 text-[11px] font-medium text-destructive">
                            {m.reason}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === "review" && selected && (
          <div className="px-5 py-4 space-y-4">
            <div className="rounded-card border border-border/70 bg-card p-3 flex gap-3">
              <ProgressiveImage
                src={selected.coverImageUrl}
                fallbackSrc={FALLBACK_COVER}
                alt=""
                containerClassName="w-16 h-16 rounded-control shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-charcoal text-sm">
                  {selected.title}
                </div>
                <div className="mt-1 text-[11px] text-charcoal-muted">
                  {formatMeetupDate(selected.date)} · {formatTime12h(selected.startTime)}
                </div>
                {selected.locationLabel && (
                  <div className="text-[11px] text-charcoal-muted truncate">
                    {selected.locationLabel}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-charcoal-muted uppercase tracking-wider">
                Personal message
              </label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={PERSONAL_MESSAGE_MAX + 20}
                className="mt-2 resize-none"
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-charcoal-muted">
                <span>Sent inside your one-to-one chat.</span>
                <span>
                  {trimmed.length}/{PERSONAL_MESSAGE_MAX}
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border/60 px-5 py-3 gap-2 sm:justify-between">
          {step === "select" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                <X className="w-4 h-4" />
                Cancel
              </Button>
              <PrimaryButton
                size="sm"
                disabled={!selected?.eligible}
                onClick={() => setStep("review")}
              >
                Continue
              </PrimaryButton>
            </>
          ) : (
            <>
              <SecondaryButton size="sm" onClick={() => setStep("select")}>
                Back
              </SecondaryButton>
              <PrimaryButton size="sm" disabled={!canSend} onClick={handleSend}>
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send Invitation
              </PrimaryButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoEligibleState({ onExplore }: { onExplore: () => void }) {
  return (
    <div className="text-center py-8 px-2">
      <div className="text-base font-semibold text-charcoal">
        No Meetups available to invite them to.
      </div>
      <p className="mt-1 text-sm text-charcoal-muted">
        Join or host an upcoming Meetup first.
      </p>
      <PrimaryButton size="sm" className="mt-5" onClick={onExplore}>
        Explore Meetups
      </PrimaryButton>
    </div>
  );
}
