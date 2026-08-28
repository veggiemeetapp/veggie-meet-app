import { memberSafeMessage } from "@/lib/errors";
import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CalendarPlus,
  Flag,
  Leaf,
  Loader2,
  MoreVertical,
  Pencil,
  Send,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { AppHeader, Card, UserAvatar, BackButton } from "@/components/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteDirectMessage,
  editDirectMessage,
  fetchThread,
  getOrCreateConversation,
  isDeletedMessage,
  markConversationRead,
  MESSAGE_DELETED_LABEL,
  MESSAGE_MAX,
  sendDirectMessage,
  type DMMessage,
  type DMOther,
} from "@/lib/directMessages";
import {
  blockProfile,
  isPairBlocked,
  submitMessageReport,
  MESSAGE_REPORT_REASONS,
} from "@/lib/safety";

import {
  fetchInvitationsBundle,
  joinFromInvitation,
  markInvitationViewed,
  type HydratedInvitation,
} from "@/lib/invitations";
import { MeetupInvitationSheet } from "@/components/invitations/MeetupInvitationSheet";
import { InvitationCard } from "@/components/invitations/InvitationCard";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSendToken } from "@/hooks/useSendToken";


const STARTER_PROMPTS = [
  "Hey! Nice to connect.",
  "Are you joining any Meetups soon?",
  "What are your favorite veggie places nearby?",
];

// Must match the server-side message report taxonomy (WO-068A validation).
const REPORT_REASONS = MESSAGE_REPORT_REASONS;

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Wrapper: resolves a stable conversationId. */
export default function DirectMessage() {
  const { conversationId, otherProfileId } = useParams();
  const navigate = useNavigate();
  const { profile, loading } = useAuth();
  const [resolvedId, setResolvedId] = useState<string | null>(
    conversationId ?? null,
  );
  // WO-088 DEF-088-03: opening /dm/user/:id before the two members are
  // connected is a normal product state, not a failure. The server refuses and
  // creates nothing; the member gets explicit copy about the actual state.
  const [resolveError, setResolveError] = useState<
    { kind: "ineligible" | "unavailable" | "error"; message: string } | null
  >(null);

  useEffect(() => {
    if (conversationId) {
      setResolvedId(conversationId);
      return;
    }
    if (loading || !profile?.id || !otherProfileId) return;
    (async () => {
      try {
        const id = await getOrCreateConversation(otherProfileId);
        // Replace URL with the canonical conversation id.
        navigate(`/dm/${id}`, { replace: true });
        setResolvedId(id);
      } catch (e) {
        const raw = String(
          (e as { message?: string } | null)?.message ?? "",
        ).toLowerCase();
        if (raw.includes("must be connected") || raw.includes("not connected")) {
          setResolveError({
            kind: "ineligible",
            message:
              "You need to be connected before you can message this Veggie. Send a connection request from their profile — once they accept, messaging opens up here.",
          });
        } else if (
          raw.includes("messaging is not available") ||
          raw.includes("invalid recipient")
        ) {
          setResolveError({
            kind: "unavailable",
            message: "Messaging isn't available with this Veggie.",
          });
        } else {
          setResolveError({
            kind: "error",
            message: memberSafeMessage(e),
          });
        }
      }
    })();
  }, [conversationId, otherProfileId, profile?.id, loading, navigate]);

  if (resolveError) {
    return (
      <>
        <BackHeader title="Chat" />
        <main className="px-5 py-10 flex flex-col items-center text-center gap-4">
          <div
            role="alert"
            aria-live="polite"
            className="max-w-sm text-sm text-charcoal"
          >
            <h1 className="text-base font-semibold text-charcoal mb-1">
              {resolveError.kind === "ineligible"
                ? "Not connected yet"
                : resolveError.kind === "unavailable"
                  ? "Messaging unavailable"
                  : "Couldn't open this chat"}
            </h1>
            <p className="text-charcoal-muted">{resolveError.message}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {resolveError.kind === "ineligible" && otherProfileId && (
              <Button asChild>
                <Link to={`/veggie/${otherProfileId}`}>View profile</Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => safeBack(navigate, "/chats")}>
              Back to Chats
            </Button>
          </div>
        </main>
      </>
    );
  }


  if (!resolvedId || !profile) {
    return (
      <>
        <BackHeader title="Chat" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-charcoal-muted" />
        </div>
      </>
    );
  }

  return <DMScreen conversationId={resolvedId} meProfileId={profile.id} />;
}

function BackHeader({
  title,
  right,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <AppHeader
      title={title}
      left={
        <BackButton fallback="/chats" />
      }
      right={right}
    />
  );
}

function DMScreen({
  conversationId,
  meProfileId,
}: {
  conversationId: string;
  meProfileId: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // WO-083: stable idempotency token per intended message (see useSendToken).
  const sendToken = useSendToken();
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [blockDialog, setBlockDialog] = useState(false);
  const [reportMessage, setReportMessage] = useState<DMMessage | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitations, setInvitations] = useState<Map<string, HydratedInvitation>>(
    new Map(),
  );
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [other, setOther] = useState<DMOther | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // WO-136: edit/delete of own messages. The server is authoritative; these
  // states only drive the surface and optimistic rendering.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DMMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mutationStatus, setMutationStatus] = useState("");


  // Bounded initial page via get_dm_thread(): peer identity, eligibility and the
  // most recent page of messages in a single RPC (no per-row queries).
  const reloadThread = useMemo(
    () => async () => {
      const t = await fetchThread(conversationId);
      setOther(t.other);
      setMessages(t.messages);
      setHasMore(t.hasMore);
    },
    [conversationId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingMsgs(true);
    setLoadError(null);
    fetchThread(conversationId)
      .then((t) => {
        if (cancelled) return;
        setOther(t.other);
        setMessages(t.messages);
        setHasMore(t.hasMore);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load this conversation."))
      .finally(() => !cancelled && setLoadingMsgs(false));
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const t = await fetchThread(conversationId, {
        createdAt: oldest.created_at,
        id: oldest.id,
      });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...t.messages.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(t.hasMore);
    } catch {
      toast.error("Couldn't load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  /* -------- WO-136: edit / delete own messages -------- */

  function startEdit(m: DMMessage) {
    setEditingId(m.id);
    setEditDraft(m.body ?? "");
  }

  function cancelEdit() {
    // The original bubble content is untouched — nothing was mutated locally.
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit() {
    const id = editingId;
    if (!id || savingEdit) return;
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed.length > MESSAGE_MAX) return;
    const original = messages.find((m) => m.id === id) ?? null;
    setSavingEdit(true);
    // Optimistic: keep created_at and position; only body + edited marker move.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, body: trimmed, edited_at: new Date().toISOString() } : m,
      ),
    );
    try {
      const saved = await editDirectMessage(id, trimmed);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...saved } : m)));
      setEditingId(null);
      setEditDraft("");
      setMutationStatus("Message edited.");
      qc.invalidateQueries({ queryKey: ["dm-inbox", meProfileId] });
    } catch (e) {
      // Roll back to server truth and keep the editor open with the draft.
      if (original) {
        setMessages((prev) => prev.map((m) => (m.id === id ? original : m)));
      }
      toast.error(memberSafeMessage(e));
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const saved = await deleteDirectMessage(target.id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id
            ? { ...m, ...saved, body: null, invitation_id: null, is_deleted: true }
            : m,
        ),
      );
      if (editingId === target.id) cancelEdit();
      setDeleteTarget(null);
      setMutationStatus("Message deleted.");
      qc.invalidateQueries({ queryKey: ["dm-inbox", meProfileId] });
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setDeleting(false);
    }
  }



  // Check block state — pair-aware so the blocked party also gets a closed
  // composer with neutral wording instead of a failing send.
  useEffect(() => {
    if (!other) return;
    isPairBlocked(other.profileId)
      .then(setBlockedByMe)
      .catch(() => setBlockedByMe(false));
  }, [other, meProfileId]);


  // Mark read on open & when new incoming arrive
  useEffect(() => {
    if (!conversationId) return;
    markConversationRead(conversationId)
      .then(() => qc.invalidateQueries({ queryKey: ["dm-inbox", meProfileId] }))
      .catch(() => {});
  }, [conversationId, meProfileId, qc, messages.length]);

  // Realtime — incoming messages + read receipts
  useEffect(() => {
    const channel = supabase
      .channel(`dm-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as DMMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dm_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // WO-136: UPDATEs now carry read receipts *and* edit/delete state.
          // The server clears `body` on delete, so the tombstone converges for
          // every participant without a reload.
          const m = payload.new as DMMessage;
          setMessages((prev) =>
            prev.map((x) =>
              x.id === m.id
                ? {
                    ...x,
                    read_at: m.read_at,
                    body: m.deleted_at ? null : (m.body ?? x.body),
                    edited_at: m.edited_at ?? null,
                    deleted_at: m.deleted_at ?? null,
                    is_deleted: !!m.deleted_at,
                    invitation_id: m.deleted_at ? null : x.invitation_id,
                  }
                : x,
            ),
          );
          if (m.deleted_at || m.edited_at) {
            qc.invalidateQueries({ queryKey: ["dm-inbox", meProfileId] });
          }
        },

      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc, meProfileId]);


  // Hydrate invitations referenced by messages, refetch whenever messages change.
  const invitationIdsKey = useMemo(
    () =>
      messages
        .map((m) => m.invitation_id)
        .filter((x): x is string => !!x)
        .sort()
        .join(","),
    [messages],
  );
  useEffect(() => {
    if (!invitationIdsKey) {
      setInvitations(new Map());
      return;
    }
    const ids = invitationIdsKey.split(",");
    let cancelled = false;
    fetchInvitationsBundle(ids, meProfileId).then((map) => {
      if (!cancelled) setInvitations(map);
    });
    return () => {
      cancelled = true;
    };
  }, [invitationIdsKey, meProfileId]);

  // Mark received invitations viewed as soon as we see them.
  useEffect(() => {
    for (const b of invitations.values()) {
      if (
        b.invitation.recipient_id === meProfileId &&
        b.invitation.status === "invited"
      ) {
        markInvitationViewed(b.invitation.id);
      }
    }
  }, [invitations, meProfileId]);

  // Realtime — invitation status changes for anything we already show,
  // plus meetup-level changes (cancellation, edits, attendance) so the
  // invitation card reflects reality without a manual refresh.
  useEffect(() => {
    if (!invitationIdsKey) return;
    const refresh = () => {
      fetchInvitationsBundle(
        invitationIdsKey.split(","),
        meProfileId,
      ).then(setInvitations);
    };
    const meetupIds = Array.from(
      new Set(
        Array.from(invitations.values()).map((b) => b.meetup.id),
      ),
    );
    const channel = supabase
      .channel(`dm-inv-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "meetup_invitations",
          filter: `conversation_id=eq.${conversationId}`,
        },
        refresh,
      );
    for (const mid of meetupIds) {
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "meetups", filter: `id=eq.${mid}` },
        refresh,
      );
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance", filter: `meetup_id=eq.${mid}` },
        refresh,
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, invitationIdsKey, meProfileId, invitations]);


  // Autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function handleJoinInvitation(invitationId: string) {
    setJoiningId(invitationId);
    try {
      await joinFromInvitation(invitationId);
      const refreshed = await fetchInvitationsBundle(
        Array.from(invitations.keys()),
        meProfileId,
      );
      setInvitations(refreshed);
      toast.success("You're going.");
    } catch (e) {
      toast.error(memberSafeMessage(e));
    } finally {
      setJoiningId(null);
    }
  }

  const grouped = useMemo(() => groupByDate(messages), [messages]);
  const overLimit = draft.length > MESSAGE_MAX;
  const canSend =
    draft.trim().length > 0 && !sending && !blockedByMe && !overLimit;

  async function handleSend() {
    if (!other || !canSend) return;
    setSending(true);
    const body = draft;
    setDraft("");
    try {
      const msg = await sendDirectMessage(
        conversationId,
        body,
        sendToken.tokenFor(body),
      );
      sendToken.clear();
      // Dedupe by canonical id: an idempotent replay returns the original row.
      setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
      qc.invalidateQueries({ queryKey: ["dm-inbox", meProfileId] });
    } catch (e) {
      // Keep the text so the member can retry; the send token is retained so a
      // retry of the same message stays idempotent.
      setDraft(body);
      toast.error(memberSafeMessage(e));
    } finally {
      setSending(false);
    }
  }

  async function handleBlockConfirmed() {
    if (!other) return;
    try {
      await blockProfile(other.profileId);
      setBlockedByMe(true);
      setBlockDialog(false);
      toast.success(`You blocked ${other.firstName}.`);
    } catch {
      toast.error("Couldn't block right now. Try again.");
    }
  }

  return (
    // WO-093 DEF-093-03 (iOS Safari / Android Chrome): the conversation owns its
    // own scroll region inside a dynamic-viewport shell. Previously the whole
    // page grew with the message list, so on a real phone the composer and Send
    // were pushed below the fold once the virtual keyboard opened. `app-viewport`
    // pins the shell to 100dvh (which tracks the Safari address bar), leaving the
    // message log as the only scroller and the composer permanently on screen.
    <div className="app-viewport flex flex-col">
      <BackHeader

        title={
          other ? (
            <Link
              to={`/veggie/${other.profileId}`}
              className="flex items-center gap-2 min-w-0"
            >
              <UserAvatar
                name={other.displayName}
                src={other.avatarUrl ?? undefined}
                size="sm"
              />
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate font-semibold text-charcoal text-[15px]">
                    {other.firstName}
                  </span>
                  {other.isVerifiedConnection && (
                    <Leaf className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </div>
                {other.city && (
                  <div className="text-[11px] text-charcoal-muted truncate">
                    {other.city}
                  </div>
                )}
              </div>
            </Link>
          ) : (
            "Chat"
          )
        }
        right={
          other && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-9 h-9 -mr-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
                  aria-label="More options"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => navigate(`/veggie/${other.profileId}`)}
                >
                  <UserIcon className="w-4 h-4" />
                  View Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setInviteOpen(true)}>
                  <CalendarPlus className="w-4 h-4" />
                  Invite to Meetup
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBlockDialog(true)}>
                  <Ban className="w-4 h-4" />
                  Block
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const lastIncoming = [...messages].reverse().find(
                      (m) => m.sender_id !== meProfileId && !m.invitation_id,
                    );
                    if (lastIncoming) setReportMessage(lastIncoming);
                    else toast.info("Tap the ⋯ on a specific message to report it.");
                  }}
                >
                  <Flag className="w-4 h-4" />
                  Report a message
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <div className="flex-1 flex flex-col min-h-0">
        <div
          className="flex-1 overflow-y-auto page-x pt-3 pb-4"
          role="log"
          aria-live="polite"
        >
          <div className="min-h-full flex flex-col justify-end space-y-4">
            {!loadingMsgs && !loadError && hasMore && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="rounded-full text-xs text-charcoal-muted"
                >
                  {loadingOlder ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Load earlier messages"
                  )}
                </Button>
              </div>
            )}
            {loadingMsgs ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-charcoal-muted" />
              </div>
            ) : loadError ? (
              <p className="text-center text-sm text-destructive py-10">
                {loadError}
              </p>
            ) : messages.length === 0 ? (
              other && (
                <EmptyConversation
                  other={other}
                  onPrompt={(t) => setDraft(t)}
                />
              )
            ) : (
              grouped.map((g) => (
                <div key={g.date} className="space-y-2">
                  <div className="text-center text-[11px] text-charcoal-muted my-2">
                    {g.date}
                  </div>
                  {g.groups.map((group, gi) => (
                    <MessageGroup
                      key={gi}
                      group={group}
                      isMe={group.senderId === meProfileId}
                      isLastInConv={
                        g === grouped[grouped.length - 1] &&
                        gi === g.groups.length - 1
                      }
                      invitations={invitations}
                      meProfileId={meProfileId}
                      onJoinInvitation={handleJoinInvitation}
                      joiningId={joiningId}
                      onReportMessage={setReportMessage}
                      actions={{
                        editingId,
                        editDraft,
                        setEditDraft,
                        savingEdit,
                        onStartEdit: startEdit,
                        onCancelEdit: cancelEdit,
                        onSaveEdit: saveEdit,
                        onRequestDelete: setDeleteTarget,
                      }}
                    />
                  ))}
                </div>
              ))
            )}
            {/* WO-136: screen-reader announcement for edit/delete results. */}
            <p role="status" aria-live="polite" className="sr-only">
              {mutationStatus}
            </p>
            <div ref={bottomRef} />

          </div>
        </div>


        {/* Composer */}
        {blockedByMe ? (
          <div className="border-t border-border/60 px-5 py-4 text-center text-sm text-charcoal-muted safe-bottom">
            You can't message this person.
          </div>
        ) : (
          <div className="border-t border-border/60 bg-background safe-bottom px-3 pt-2 pb-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a message…"
                rows={1}
                aria-label="Message"
                className="min-h-[42px] max-h-32 resize-none bg-muted/60 border-transparent focus-visible:bg-background"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                aria-label="Send"
                disabled={!canSend}
                onClick={handleSend}
                className="h-10 w-10 shrink-0 rounded-full"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            {overLimit && (
              <p className="mt-1 text-[11px] text-destructive">
                Messages must be under {MESSAGE_MAX} characters.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Block confirmation */}
      <Dialog open={blockDialog} onOpenChange={setBlockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block {other?.firstName}?</DialogTitle>
            <DialogDescription>
              You will no longer be able to message each other.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBlockConfirmed}>
              Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {other && reportMessage && (
        <ReportDialog
          open={!!reportMessage}
          onOpenChange={(o) => { if (!o) setReportMessage(null); }}
          otherName={other.firstName}
          messagePreview={reportMessage.body ?? undefined}
          messageTimestamp={reportMessage.created_at}
          onSubmit={async (reason, details) => {
            try {
              await submitMessageReport({
                messageId: reportMessage.id,
                reason,
                details,
              });
              toast.success("Report submitted. Thank you.");
              setReportMessage(null);
            } catch (e) {
              toast.error(memberSafeMessage(e));
            }
          }}
        />
      )}

      {/* WO-136: destructive confirmation — deletion affects both participants. */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>
              It will be removed for everyone in this conversation and replaced
              with “{MESSAGE_DELETED_LABEL}”. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete message"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {other && (
        <MeetupInvitationSheet
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          senderProfileId={meProfileId}
          recipient={{
            profileId: other.profileId,
            firstName: other.firstName,
            displayName: other.displayName,
          }}
          onSent={async () => {
            await reloadThread();
          }}
        />
      )}
    </div>

  );
}

function EmptyConversation({
  other,
  onPrompt,
}: {
  other: DMOther;
  onPrompt: (text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center text-center pt-10 pb-4 page-x">
      <UserAvatar
        name={other.displayName}
        src={other.avatarUrl ?? undefined}
        size="xl"
      />
      <h2 className="mt-3 text-lg font-semibold text-charcoal">
        Start a conversation with {other.firstName}.
      </h2>
      <p className="mt-1 text-sm text-charcoal-muted max-w-xs">
        Say hello or ask about an upcoming Meetup.
      </p>
      <div className="mt-5 w-full flex flex-col gap-2">
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className="w-full text-left rounded-card border border-border/70 bg-card px-4 py-2.5 text-sm text-charcoal hover:bg-muted/60 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Group {
  senderId: string;
  messages: DMMessage[];
}
interface DayBucket {
  date: string;
  groups: Group[];
}

function groupByDate(msgs: DMMessage[]): DayBucket[] {
  const buckets = new Map<string, DMMessage[]>();
  for (const m of msgs) {
    const key = formatDateSeparator(m.created_at);
    const arr = buckets.get(key) ?? [];
    arr.push(m);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries()).map(([date, list]) => {
    const groups: Group[] = [];
    for (const m of list) {
      const last = groups[groups.length - 1];
      if (
        last &&
        last.senderId === m.sender_id &&
        new Date(m.created_at).getTime() -
          new Date(last.messages[last.messages.length - 1].created_at).getTime() <
          5 * 60 * 1000
      ) {
        last.messages.push(m);
      } else {
        groups.push({ senderId: m.sender_id, messages: [m] });
      }
    }
    return { date, groups };
  });
}

interface MessageActions {
  editingId: string | null;
  editDraft: string;
  setEditDraft: (v: string) => void;
  savingEdit: boolean;
  onStartEdit: (m: DMMessage) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRequestDelete: (m: DMMessage) => void;
}

function MessageGroup({
  group,
  isMe,
  isLastInConv,
  invitations,
  meProfileId,
  onJoinInvitation,
  joiningId,
  onReportMessage,
  actions,
}: {
  group: Group;
  isMe: boolean;
  isLastInConv: boolean;
  invitations: Map<string, HydratedInvitation>;
  meProfileId: string;
  onJoinInvitation: (invitationId: string) => void;
  joiningId: string | null;
  onReportMessage?: (m: DMMessage) => void;
  actions?: MessageActions;
}) {
  const last = group.messages[group.messages.length - 1];
  const showRead = isMe && isLastInConv;
  return (
    <div className={cn("flex", isMe ? "justify-end" : "justify-start")}>
      <div className="max-w-[86%] flex flex-col gap-1.5 items-stretch">
        {group.messages.map((m) => {
          const bundle = m.invitation_id ? invitations.get(m.invitation_id) : null;
          if (bundle) {
            return (
              <InvitationCard
                key={m.id}
                bundle={bundle}
                isRecipient={bundle.invitation.recipient_id === meProfileId}
                isSender={bundle.invitation.sender_id === meProfileId}
                onJoin={() => onJoinInvitation(bundle.invitation.id)}
                joining={joiningId === bundle.invitation.id}
              />
            );
          }

          // WO-136: tombstone — the server clears the body, so there is no
          // original text to leak here.
          if (isDeletedMessage(m)) {
            return (
              <div
                key={m.id}
                className={cn(
                  "px-3.5 py-2 rounded-card text-sm italic text-charcoal-muted border border-dashed border-border",
                  isMe ? "self-end rounded-br-md" : "self-start rounded-bl-md",
                )}
              >
                {MESSAGE_DELETED_LABEL}
              </div>
            );
          }

          // WO-136: inline edit surface for the author's own message.
          if (actions && actions.editingId === m.id) {
            const trimmed = actions.editDraft.trim();
            const tooLong = trimmed.length > MESSAGE_MAX;
            return (
              <div
                key={m.id}
                className="self-end w-full rounded-card border border-primary/40 bg-background p-2"
              >
                <Textarea
                  autoFocus
                  aria-label="Edit message"
                  value={actions.editDraft}
                  onChange={(e) => actions.setEditDraft(e.target.value)}
                  rows={2}
                  className="min-h-[52px] max-h-40 resize-none text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      actions.onCancelEdit();
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (trimmed && !tooLong) actions.onSaveEdit();
                    }
                  }}
                />
                {tooLong && (
                  <p className="mt-1 text-[11px] text-destructive">
                    Messages must be under {MESSAGE_MAX} characters.
                  </p>
                )}
                {!trimmed && (
                  <p className="mt-1 text-[11px] text-charcoal-muted">
                    A message can't be empty. Use Delete message instead.
                  </p>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={actions.onCancelEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!trimmed || tooLong || actions.savingEdit}
                    onClick={actions.onSaveEdit}
                  >
                    {actions.savingEdit ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            );
          }

          const menuLabel = `Message options for your message sent ${formatTime(m.created_at)}`;
          return (
            <div key={m.id} className="group/msg relative flex items-start gap-1.5">
              <div
                className={cn(
                  "px-3.5 py-2 rounded-card text-sm break-words whitespace-pre-wrap",
                  isMe
                    ? "bg-soft-green text-charcoal rounded-br-md self-end"
                    : "bg-muted text-charcoal rounded-bl-md self-start",
                )}
              >
                {m.body}
                {m.edited_at && (
                  <span className="ml-1.5 align-baseline text-[10px] text-charcoal-muted">
                    (Edited)
                  </span>
                )}
              </div>
              {isMe && actions && !m.invitation_id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={menuLabel}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal-muted hover:bg-muted opacity-70 hover:opacity-100"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => actions.onStartEdit(m)}>
                      <Pencil className="w-4 h-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => actions.onRequestDelete(m)}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete message
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {!isMe && onReportMessage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Message options for message sent ${formatTime(m.created_at)}`}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal-muted hover:bg-muted opacity-60 hover:opacity-100"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onReportMessage(m)}>
                      <Flag className="w-4 h-4" />
                      Report this message
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        <div
          className={cn(
            "text-[10px] text-charcoal-muted mt-0.5",
            isMe ? "text-right" : "text-left",
          )}
        >
          {formatTime(last.created_at)}
          {showRead && !isDeletedMessage(last) && (
            <span className="ml-1.5">· {last.read_at ? "Read" : "Sent"}</span>
          )}
        </div>
      </div>
    </div>
  );
}


function ReportDialog({
  open,
  onOpenChange,
  otherName,
  messagePreview,
  messageTimestamp,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  otherName: string;
  messagePreview?: string;
  messageTimestamp?: string;
  onSubmit: (reason: string, details?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].id);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason(REPORT_REASONS[0].id);
      setDetails("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report message from {otherName}</DialogTitle>
          <DialogDescription>
            Your report is private. {otherName} isn't notified.
          </DialogDescription>
        </DialogHeader>
        {messagePreview && (
          <div className="rounded-card bg-muted p-3 text-sm text-charcoal">
            <p className="text-[11px] text-charcoal-muted mb-1">
              Reporting this message
              {messageTimestamp ? ` · ${formatTime(messageTimestamp)}` : ""}
            </p>
            <p className="line-clamp-4 whitespace-pre-wrap break-words">
              {messagePreview}
            </p>
          </div>
        )}
        <RadioGroup value={reason} onValueChange={setReason} className="gap-2">
          {REPORT_REASONS.map((r) => (
            <Label
              key={r.id}
              htmlFor={`report-${r.id}`}
              className="flex items-center gap-3 rounded-control border border-border/70 px-3 py-2 cursor-pointer hover:bg-muted/50"
            >
              <RadioGroupItem id={`report-${r.id}`} value={r.id} />
              <span className="text-sm">{r.label}</span>
            </Label>
          ))}
        </RadioGroup>
        <Textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Add details (optional)"
          rows={3}
          className="resize-none"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(reason, details.trim() || undefined);
              } finally {
                setBusy(false);
              }
            }}
          >
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
