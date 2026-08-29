import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Leaf, Search, MessageCircle, MoreVertical, Trash2 } from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  NotificationsBell,
  PrimaryButton,
  UserAvatar,
} from "@/components/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteChatDialog } from "@/components/chat/DeleteChatDialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  deleteConversationForMe,
  fetchInbox,
  MESSAGE_DELETED_LABEL,
  type DMInboxItem,
} from "@/lib/directMessages";
import { showErrorToast } from "@/lib/errorToast";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

function formatInboxTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  if (now.getTime() - d.getTime() < oneWeek)
    return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * WO-139: focus the Chats heading (redirect target + empty-state fallback).
 * DEF-139-04: after a cross-route redirect the heading can mount a frame later
 * than the arrival effect, so retry for a few frames before giving up.
 */
function focusChatsHeading(attempt = 0) {
  const h = document.querySelector("h1");
  if (!(h instanceof HTMLElement)) {
    if (attempt < 20) requestAnimationFrame(() => focusChatsHeading(attempt + 1));
    return;
  }
  h.setAttribute("tabindex", "-1");
  h.focus();
}

export default function Chats() {
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const qc = useQueryClient();
  // WO-139 per-member "Delete chat" state.
  const [deleteTarget, setDeleteTarget] = useState<DMInboxItem | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const inboxQuery = useQuery({
    queryKey: ["dm-inbox", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => fetchInbox(),
  });

  // WO-139: arriving here after deleting from inside a conversation moves focus
  // to the Chats heading so keyboard/screen-reader users are not left adrift.
  const focusHeadingOnArrival = !!(
    routerLocation.state as { focusChatsHeading?: boolean } | null
  )?.focusChatsHeading;
  useEffect(() => {
    if (!focusHeadingOnArrival) return;
    // DEF-139-04: AppShell moves focus to <main> on every route change and that
    // parent effect runs after this one, so defer a frame and claim the heading
    // afterwards — otherwise the redirect would land focus on the container.
    requestAnimationFrame(() => focusChatsHeading());
    // DEF-139-05: the success announcement must survive the redirect from the
    // conversation, where the deleted screen unmounts before it can be read.
    setAnnouncement("Chat deleted");
    navigate(routerLocation.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHeadingOnArrival]);

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`dm-inbox-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_messages" },
        () => qc.invalidateQueries({ queryKey: ["dm-inbox", profile.id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_conversations" },
        () => qc.invalidateQueries({ queryKey: ["dm-inbox", profile.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, qc]);

  const items = inboxQuery.data ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      return (
        i.other.firstName.toLowerCase().includes(needle) ||
        (i.other.city ?? "").toLowerCase().includes(needle) ||
        (i.lastMessageBody ?? "").toLowerCase().includes(needle)
      );
    });
  }, [items, q]);

  const optionsButtonId = (conversationId: string) =>
    `conversation-options-${conversationId}`;

  /**
   * WO-139: after a successful delete, move focus to the next conversation's
   * options control, else the previous one, else the Chats heading.
   */
  const moveFocusAfterDelete = useCallback(
    (deletedId: string) => {
      const order = filtered.map((i) => i.conversationId);
      const idx = order.indexOf(deletedId);
      const nextId = order[idx + 1] ?? order[idx - 1] ?? null;
      requestAnimationFrame(() => {
        const el = nextId
          ? document.getElementById(optionsButtonId(nextId))
          : null;
        if (el instanceof HTMLElement) el.focus();
        else focusChatsHeading();
      });
    },
    [filtered],
  );

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await deleteConversationForMe(target.conversationId);
      setDeleteTarget(null);
      // Only mutate local state once the server has confirmed, so a failure can
      // never leave optimistic state out of sync.
      qc.setQueryData<DMInboxItem[]>(["dm-inbox", profile?.id], (prev) =>
        (prev ?? []).filter((i) => i.conversationId !== target.conversationId),
      );
      qc.invalidateQueries({ queryKey: ["dm-inbox", profile?.id] });
      setAnnouncement(`Chat with ${target.other.firstName} deleted`);
      toast.success("Chat deleted");
      moveFocusAfterDelete(target.conversationId);
    } catch (error) {
      // Keep the conversation visible and the member on this screen.
      showErrorToast(error, { surface: "chats_delete_conversation" });
      setAnnouncement("Couldn't delete this chat. Please try again.");
      const trigger = document.getElementById(
        optionsButtonId(target.conversationId),
      );
      if (trigger instanceof HTMLElement) trigger.focus();
    }
  }, [deleteTarget, moveFocusAfterDelete, profile?.id, qc]);

  return (
    <>
      <AppHeader
        title="Chats"
        subtitle="Conversations with your Veggie Network."
        right={<NotificationsBell />}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {items.length > 0 && (
        <div className="px-5 mt-1 mb-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-muted" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search conversations"
              className="pl-9 bg-muted/60 border-transparent focus-visible:bg-background"
              aria-label="Search conversations"
            />
          </div>
        </div>
      )}

      {inboxQuery.isLoading ? (
        <div className="px-5 space-y-2">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="h-16 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="w-6 h-6" />}
          title="No conversations yet"
          description="Meetup group chats and messages with your connections both appear here."
          action={
            <PrimaryButton onClick={() => navigate("/community")}>
              Explore Community
            </PrimaryButton>
          }
        />
      ) : (
        <ul className="px-5 space-y-2">
          {filtered.map((c) => (
            <InboxRow
              key={c.conversationId}
              item={c}
              meId={profile!.id}
              optionsButtonId={optionsButtonId(c.conversationId)}
              onRequestDelete={() => setDeleteTarget(c)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-charcoal-muted text-center pt-6">
              No matches for "{q}"
            </p>
          )}
        </ul>
      )}

      <DeleteChatDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (open) return;
          // WO-139: dismissing without deleting returns focus to the control
          // that opened the dialog, since the dropdown trigger is gone by then.
          const id = deleteTarget && optionsButtonId(deleteTarget.conversationId);
          setDeleteTarget(null);
          requestAnimationFrame(() => {
            const el = id ? document.getElementById(id) : null;
            if (el instanceof HTMLElement) el.focus();
          });
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function InboxRow({
  item,
  meId,
  optionsButtonId,
  onRequestDelete,
}: {
  item: DMInboxItem;
  meId: string;
  optionsButtonId: string;
  onRequestDelete: () => void;
}) {
  const isUnread = item.unreadCount > 0;
  const previewPrefix = item.lastSenderId === meId ? "You: " : "";
  return (
    <li className="relative">
      <Link
        to={`/dm/${item.conversationId}`}
        className="block"
        aria-label={`Chat with ${item.other.firstName}${
          isUnread ? `, ${item.unreadCount} unread` : ""
        }`}
      >
        <Card interactive className="flex items-center gap-3 pr-12">
          <UserAvatar
            name={item.other.displayName}
            src={item.other.avatarUrl ?? undefined}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3
                className={
                  isUnread
                    ? "font-semibold text-charcoal truncate"
                    : "font-medium text-charcoal truncate"
                }
              >
                {item.other.firstName}
              </h3>
              {item.other.isVerifiedConnection && (
                <Leaf
                  className="w-3.5 h-3.5 text-primary shrink-0"
                  aria-label="Verified Connection"
                />
              )}
              <span className="ml-auto shrink-0 text-[11px] text-charcoal-muted">
                {formatInboxTime(item.lastMessageAt)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p
                className={
                  isUnread
                    ? "text-sm text-charcoal truncate flex-1"
                    : "text-sm text-charcoal-muted truncate flex-1"
                }
              >
                {/* WO-136: a deleted latest message shows a neutral tombstone
                    preview instead of the original content. */}
                {item.lastMessageIsDeleted ? (
                  <span className="italic">{MESSAGE_DELETED_LABEL}</span>
                ) : item.lastMessageBody ? (
                  `${previewPrefix}${item.lastMessageBody}`
                ) : (
                  "Say hello 👋"
                )}
              </p>

              {isUnread && (
                <span
                  className="shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
                  aria-label={`${item.unreadCount} unread messages`}
                >
                  {item.unreadCount > 9 ? "9+" : item.unreadCount}
                </span>
              )}
            </div>
          </div>
        </Card>
      </Link>

      {/* WO-139: conversation options sit outside the Link so activating them
          can never open the conversation. 44px touch target. */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              id={optionsButtonId}
              type="button"
              className="w-11 h-11 rounded-full flex items-center justify-center text-charcoal-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Conversation options for ${item.other.firstName}`}
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onRequestDelete}
            >
              <Trash2 className="w-4 h-4" />
              Delete chat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
