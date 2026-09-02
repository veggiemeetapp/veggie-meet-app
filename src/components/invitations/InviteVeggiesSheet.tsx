import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, Send, Users, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PrimaryButton, SecondaryButton, UserAvatar } from "@/components/app";
import {
  candidateSelectable,
  fetchInviteCandidates,
  INVITE_MESSAGE_MAX,
  INVITE_SELECTION_MAX,
  isRateLimited,
  sendMeetupInvitations,
  sendResultSummary,
  type InviteCandidate,
} from "@/lib/meetupInvites";

import { DEFAULT_INVITATION_MESSAGE } from "@/lib/invitations";
import { logAnalyticsEvent } from "@/lib/analytics";
import { memberSafeMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  meetupId: string;
  /** Optional label used in the sheet subtitle. */
  meetupTitle?: string;
  onSent?: (invitedCount: number) => void;
}

/**
 * WO-144 — host-facing multi-select invitation sheet.
 *
 * Only connected Veggies are listed (server-filtered). Already-attending and
 * already-invited Veggies are shown but not selectable, so the host always sees
 * why someone can't be invited again.
 */
export function InviteVeggiesSheet({
  open,
  onOpenChange,
  meetupId,
  meetupTitle,
  onSent,
}: Props) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState(DEFAULT_INVITATION_MESSAGE);
  const [sending, setSending] = useState(false);

  const candidatesQuery = useQuery({
    queryKey: ["meetup-invite-candidates", meetupId],
    queryFn: () => fetchInviteCandidates(meetupId),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected([]);
    setMessage(DEFAULT_INVITATION_MESSAGE);
    logAnalyticsEvent("meetup_invite_sheet_opened", { meetup_id: meetupId });
  }, [open, meetupId]);

  const candidates = candidatesQuery.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        (c.cityName ?? "").toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const selectableFiltered = filtered.filter(candidateSelectable);
  const allFilteredSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((c) => selected.includes(c.profileId));

  const trimmed = message.trim();
  const atLimit = selected.length >= INVITE_SELECTION_MAX;

  function toggle(c: InviteCandidate) {
    if (!candidateSelectable(c)) return;
    setSelected((prev) => {
      if (prev.includes(c.profileId)) {
        return prev.filter((id) => id !== c.profileId);
      }
      if (prev.length >= INVITE_SELECTION_MAX) {
        toast.error(`You can invite up to ${INVITE_SELECTION_MAX} Veggies at a time.`);
        return prev;
      }
      return [...prev, c.profileId];
    });
  }

  function toggleAll() {
    if (allFilteredSelected) {
      const ids = new Set(selectableFiltered.map((c) => c.profileId));
      setSelected((prev) => prev.filter((id) => !ids.has(id)));
      return;
    }
    setSelected((prev) => {
      const next = [...prev];
      for (const c of selectableFiltered) {
        if (next.length >= INVITE_SELECTION_MAX) break;
        if (!next.includes(c.profileId)) next.push(c.profileId);
      }
      if (next.length >= INVITE_SELECTION_MAX && selectableFiltered.length > next.length) {
        toast.error(`Only the first ${INVITE_SELECTION_MAX} Veggies were selected.`);
      }
      return next;
    });
  }

  const nameFor = (profileId: string) =>
    candidates.find((c) => c.profileId === profileId)?.firstName ?? "Veggie";

  async function handleSend() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await sendMeetupInvitations(meetupId, selected, trimmed);
      const { title, description } = sendResultSummary(result, nameFor);
      if (result.invitedCount > 0) toast.success(title, { description });
      else toast.error(title, { description });
      logAnalyticsEvent("meetup_invitations_sent", {
        meetup_id: meetupId,
        invited_count: result.invitedCount,
        skipped_count: result.skipped.length,
        selected_count: selected.length,
      });
      await qc.invalidateQueries({ queryKey: ["meetup-invite-candidates", meetupId] });
      onSent?.(result.invitedCount);
      // WO-144B: a fully rate-limited batch keeps the sheet open so the host can
      // retry later without rebuilding the selection.
      if (!isRateLimited(result)) onOpenChange(false);
    } catch (e) {
      logAnalyticsEvent("meetup_invitations_failed", {
        meetup_id: meetupId,
        selected_count: selected.length,
      });
      toast.error(memberSafeMessage(e));
    } finally {
      setSending(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle className="text-base">Invite Veggies</DialogTitle>
          <DialogDescription className="text-xs">
            {meetupTitle
              ? `Invite connected Veggies to ${meetupTitle}.`
              : "Invite connected Veggies to this Meetup."}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your Veggie Network"
              className="pl-9"
              aria-label="Search your Veggie Network"
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-charcoal-muted">
            <span aria-live="polite">
              {selected.length} selected · up to {INVITE_SELECTION_MAX}
            </span>
            {selectableFiltered.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={toggleAll}
              >
                {allFilteredSelected ? "Clear all" : "Select all"}
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-[42vh] overflow-y-auto px-5 py-3">
          {candidatesQuery.isPending ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-charcoal-muted" />
            </div>
          ) : candidatesQuery.isError ? (
            <p className="text-sm text-destructive text-center py-6">
              Couldn't load your Veggie Network.
            </p>
          ) : candidates.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-6 h-6 mx-auto text-charcoal-muted" />
              <p className="mt-2 text-sm font-semibold text-charcoal">
                No connections yet
              </p>
              <p className="mt-1 text-xs text-charcoal-muted">
                Connect with Veggies first, then invite them here.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-charcoal-muted text-center py-6">
              No Veggies match “{query.trim()}”.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((c) => {
                const isSelected = selected.includes(c.profileId);
                const selectable = candidateSelectable(c);
                const blockedReason = c.alreadyAttending
                  ? "Already attending"
                  : c.alreadyInvited
                    ? "Already invited"
                    : null;
                return (
                  <li key={c.profileId}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      // WO-144B: never use the `disabled` attribute here — a
                      // disabled control is unreachable by keyboard, which would
                      // hide the "Already invited"/"Already attending" reason
                      // from screen-reader users. aria-disabled keeps the row
                      // focusable and announced while `toggle` ignores the press.
                      aria-disabled={!selectable || (atLimit && !isSelected)}
                      aria-label={
                        blockedReason
                          ? `${c.displayName} — ${blockedReason}`
                          : c.displayName
                      }
                      onClick={() => toggle(c)}
                      className={cn(
                        "w-full text-left rounded-card border p-2.5 flex items-center gap-3 transition-colors",
                        isSelected
                          ? "border-primary bg-soft-green/70"
                          : "border-border/70 bg-card",
                        selectable
                          ? "hover:bg-muted/50"
                          : "opacity-60 cursor-not-allowed",
                      )}
                    >

                      <UserAvatar
                        src={c.avatarUrl ?? undefined}
                        seed={c.profileId}
                        name={c.displayName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-charcoal truncate">
                          {c.displayName}
                        </div>
                        <div className="text-[11px] text-charcoal-muted truncate">
                          {blockedReason ?? c.cityName ?? "Connected"}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                          isSelected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border",
                        )}
                        aria-hidden="true"
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected.length > 0 && (
          <div className="px-5 pb-3">
            <label
              htmlFor="invite-message"
              className="text-xs font-semibold text-charcoal-muted uppercase tracking-wider"
            >
              Message
            </label>
            <Textarea
              id="invite-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={INVITE_MESSAGE_MAX}
              className="mt-2 resize-none"
            />
            <div className="mt-1 text-right text-[11px] text-charcoal-muted">
              {trimmed.length}/{INVITE_MESSAGE_MAX}
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border/60 px-5 py-3 gap-2 sm:justify-between">
          <SecondaryButton size="sm" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4" />
            Cancel
          </SecondaryButton>
          <PrimaryButton
            size="sm"
            disabled={selected.length === 0 || sending}
            onClick={handleSend}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {selected.length > 0
              ? `Send ${selected.length} invitation${selected.length === 1 ? "" : "s"}`
              : "Send invitations"}
          </PrimaryButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
