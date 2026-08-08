import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Leaf, Search, MessageCircle } from "lucide-react";
import {
  AppHeader,
  Card,
  EmptyState,
  NotificationsBell,
  PrimaryButton,
  UserAvatar,
} from "@/components/app";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { fetchInbox, type DMInboxItem } from "@/lib/directMessages";
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

export default function Chats() {
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ["dm-inbox", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => fetchInbox(),
  });

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

  return (
    <>
      <AppHeader
        title="Chats"
        subtitle="Conversations with your Veggie Network."
        right={<NotificationsBell />}
      />

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
          title="No conversations yet."
          description="Connect with Veggies through Meetups or the Community to start a conversation."
          action={
            <PrimaryButton onClick={() => navigate("/community")}>
              Explore Community
            </PrimaryButton>
          }
        />
      ) : (
        <ul className="px-5 space-y-2">
          {filtered.map((c) => (
            <InboxRow key={c.conversationId} item={c} meId={profile!.id} />
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-charcoal-muted text-center pt-6">
              No matches for "{q}"
            </p>
          )}
        </ul>
      )}
    </>
  );
}

function InboxRow({ item, meId }: { item: DMInboxItem; meId: string }) {
  const isUnread = item.unreadCount > 0;
  const previewPrefix = item.lastSenderId === meId ? "You: " : "";
  return (
    <li>
      <Link
        to={`/dm/${item.conversationId}`}
        className="block"
        aria-label={`Chat with ${item.other.firstName}${
          isUnread ? `, ${item.unreadCount} unread` : ""
        }`}
      >
        <Card interactive className="flex items-center gap-3">
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
                {item.lastMessageBody
                  ? `${previewPrefix}${item.lastMessageBody}`
                  : "Say hello 👋"}
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
    </li>
  );
}
