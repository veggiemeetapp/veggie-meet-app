import { memberSafeMessage } from "@/lib/errors";
import { safeBack } from "@/lib/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, Calendar, Clock, MapPin, Users, EyeOff } from "lucide-react";
import { AppHeader, Card, UserAvatar, BackButton } from "@/components/app";
import {
  formatMeetupDate,
  formatTime12h,
  formatTimeRange,
} from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { isUuid } from "@/lib/backend";
import { toast } from "@/hooks/use-toast";
import { useSendToken } from "@/hooks/useSendToken";
import {
  fetchMeetupChatContext,
  fetchMeetupChatThread,
  sendMeetupChatMessage,
  postBlockedCopy,
  type ChatMessage,
  type MeetupChatContext,
} from "@/lib/meetupChat";

export default function MeetupChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const isDb = !!id && isUuid(id);

  const [context, setContext] = useState<MeetupChatContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // WO-083: idempotency token so an ambiguous retry cannot duplicate a post.
  const sendToken = useSendToken();

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) =>
        a.created_at === b.created_at
          ? a.id.localeCompare(b.id)
          : a.created_at.localeCompare(b.created_at),
      );
    });
  }, []);

  // Load context + first page. Wait for auth so RLS-gated reads see the user.
  useEffect(() => {
    if (!isDb || !id || authLoading) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const ctx = await fetchMeetupChatContext(id);
        if (cancelled) return;
        setContext(ctx);
        if (!ctx.can_read) {
          setLoadError(
            "This chat is only open to Veggies going to this Meetup.",
          );
          return;
        }
        const page = await fetchMeetupChatThread(id);
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.has_more);
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            memberSafeMessage(e),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isDb, authLoading, reloadKey]);

  // Realtime: RLS-scoped inserts for this chat. Re-read the row via the RPC
  // page so blocking suppression and sender identity stay server-derived.
  useEffect(() => {
    if (!isDb || !id || authLoading || !context?.can_read) return;
    const channel = supabase
      .channel(`meetup-chat:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${id}` },
        () => {
          fetchMeetupChatThread(id)
            .then((page) => mergeMessages(page.messages))
            .catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, isDb, authLoading, context?.can_read, mergeMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const meetup = context?.meetup;
  const canPost = !!context?.can_post;
  const blockedCopy = useMemo(
    () => postBlockedCopy(context?.post_block_reason ?? null),
    [context?.post_block_reason],
  );

  const loadOlder = async () => {
    if (!id || messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const first = messages[0];
      const page = await fetchMeetupChatThread(id, {
        createdAt: first.created_at,
        id: first.id,
      });
      mergeMessages(page.messages);
      setHasMore(page.has_more);
    } catch {
      /* keep current view */
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !id || !canPost || sending) return;
    setSending(true);
    try {
      const saved = await sendMeetupChatMessage(id, body, sendToken.tokenFor(body));
      sendToken.clear();
      setDraft("");
      mergeMessages([saved]);
    } catch (err) {
      toast({
        title: "Message not sent",
        description: memberSafeMessage(err),
        variant: "destructive",
      });
      const ctx = await fetchMeetupChatContext(id).catch(() => null);
      if (ctx) setContext(ctx);
    } finally {
      setSending(false);
    }
  };

  if (!isDb || loadError || (!context && !authLoading)) {
    return (
      <div className="flex flex-col min-h-dvh">
        <AppHeader
          title="Meetup chat"
          left={
            <BackButton fallback="/chats" />
          }
        />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">
            {loadError ??
              "This chat isn't available. You may need to join the Meetup first."}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="text-sm font-semibold text-primary px-4 py-2 rounded-full bg-soft-green/50"
            >
              Try again
            </button>
            <button
              onClick={() => navigate("/")}
              className="text-sm font-semibold text-charcoal-muted px-4 py-2"
            >
              Back to Today
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="flex flex-col min-h-dvh">
        <AppHeader title="Meetup chat" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-charcoal font-medium">Loading chat…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh bg-muted/20">
      <AppHeader
        title={meetup?.title ?? "Meetup chat"}
        subtitle={
          meetup
            ? `${formatMeetupDate(meetup.date)} · ${formatTime12h(meetup.start_time.slice(0, 5))}`
            : undefined
        }
        left={
          <BackButton fallback="/chats" />
        }
      />

      {meetup && (
        <div className="px-4 pt-3">
          <Card padding="md" className="bg-soft-green/40 border-primary/20">
            <div className="text-[11px] font-semibold text-primary uppercase tracking-wider">
              Pinned
            </div>
            <div className="mt-1 text-sm font-semibold text-charcoal">
              {context.post_block_reason === "cancelled"
                ? "This Meetup was cancelled."
                : context.post_block_reason === "completed"
                  ? `This Meetup happened ${formatMeetupDate(meetup.date).toLowerCase()}.`
                  : context.post_block_reason === "archived"
                    ? `This Meetup wrapped up on ${formatMeetupDate(meetup.date)}.`
                    : `See everyone ${formatMeetupDate(meetup.date).toLowerCase()} at ${formatTime12h(meetup.start_time.slice(0, 5))}.`}
            </div>

            <div className="mt-2 space-y-1.5 text-xs text-charcoal">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                <span>{formatMeetupDate(meetup.date)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>
                  {formatTimeRange(
                    meetup.start_time.slice(0, 5),
                    meetup.end_time.slice(0, 5),
                  )}
                </span>
              </div>
              {meetup.location_name && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-primary mt-0.5" />
                  <span>
                    <span className="font-medium">{meetup.location_name}</span>
                    {meetup.address && (
                      <span className="text-charcoal-muted"> · {meetup.address}</span>
                    )}
                  </span>
                </div>
              )}
              {!!context.participant_count && (
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  <span>{context.participant_count} Veggies going</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <div className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
        {hasMore && (
          <div className="flex justify-center">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="text-xs font-semibold text-primary px-4 py-2 rounded-full bg-soft-green/50 disabled:opacity-50"
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col items-center text-center px-6 py-12">
            <p className="text-sm font-medium text-charcoal">
              Be the first to say hello 👋
            </p>
          </div>
        )}
        {messages.map((m) => {
          if (m.type === "system") {
            return (
              <div
                key={m.id}
                className="text-center text-[11px] text-charcoal-muted py-1"
              >
                {m.body}
              </div>
            );
          }
          if (m.is_suppressed) {
            return (
              <div
                key={m.id}
                className="flex items-center justify-center gap-1.5 text-[11px] text-charcoal-muted py-1"
              >
                <EyeOff className="w-3 h-3" />
                <span>Message hidden</span>
              </div>
            );
          }
          const isMe = m.is_mine || (!!profile?.id && m.sender_id === profile.id);
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}
            >
              {!isMe && m.sender_name && (
                <UserAvatar
                  name={m.sender_name}
                  src={m.sender_avatar_url ?? undefined}
                  size="sm"
                />
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                  isMe
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card text-charcoal border border-border/60 rounded-bl-md"
                }`}
              >
                {!isMe && m.sender_name && (
                  <div className="text-[11px] font-semibold mb-0.5 text-primary">
                    {m.sender_name}
                  </div>
                )}
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {canPost ? (
        <form
          onSubmit={handleSend}
          className="safe-bottom border-t border-border/60 p-3 flex items-center gap-2 bg-background"
        >
          <input
            aria-label="Message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            placeholder="Introduce yourself or ask a meetup question..."
            className="flex-1 h-11 rounded-full bg-muted px-4 text-sm outline-none placeholder:text-charcoal-muted focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      ) : (
        <div className="safe-bottom border-t border-border/60 p-4 bg-background">
          <p className="text-xs text-charcoal-muted text-center">
            {blockedCopy ?? "This chat is read-only."}
          </p>
        </div>
      )}
    </div>
  );
}
