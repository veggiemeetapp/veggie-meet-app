import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, Calendar, Clock, MapPin, Users } from "lucide-react";
import { AppHeader, Card, UserAvatar } from "@/components/app";
import {
  getChat,
  getMeetup,
  getPlace,
  getVeggie,
  currentUser,
} from "@/lib/mock-data";
import {
  formatMeetupDate,
  formatTime12h,
  formatTimeRange,
} from "@/lib/format";
import type { Chat, Meetup, Message } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchMessages,
  isUuid,
  sendMessage,
} from "@/lib/backend";

interface ResolvedChat {
  chat: Chat | null;
  meetup: Meetup | null;
}

export default function MeetupChat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();

  const mockChat = id ? getChat(id) : undefined;
  const mockMeetup = mockChat ? getMeetup(mockChat.meetupId) : undefined;

  const [resolved, setResolved] = useState<ResolvedChat | null>(
    mockChat && mockMeetup
      ? { chat: mockChat, meetup: mockMeetup }
      : null,
  );
  const [dbMessages, setDbMessages] = useState<Message[]>([]);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const isDb = !!id && isUuid(id);

  // Resolve DB chat/meetup when route id is a UUID. Wait for auth to hydrate
  // so RLS-gated reads see the current user.
  useEffect(() => {
    if (!id || !isDb) return;
    if (authLoading) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      const { data: chatRow, error } = await supabase
        .from("chats")
        .select("id, meetup_id, meetups(*)")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !chatRow) {
        setLoadError(
          "This chat isn't available yet. You may need to join the meetup first.",
        );
        return;
      }
      const m = (chatRow as { meetups?: Record<string, unknown> | null }).meetups;
      const meetup: Meetup | null = m
        ? {
            id: m.id as string,
            title: m.title as string,
            description: (m.description as string) ?? "",
            category: (m.category as Meetup["category"]) ?? "other",
            hostId: m.host_id as string,
            communityPlaceId: (m.community_place_id as string) ?? "",
            coverImageUrl:
              (m.cover_image_url as string) ||
              "https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=1200&q=80",
            date: m.date as string,
            startTime: ((m.start_time as string) || "").slice(0, 5),
            endTime: ((m.end_time as string) || "").slice(0, 5),
            attendeeIds: [m.host_id as string],
            capacity: m.capacity as number,
            status: (m.status as Meetup["status"]) ?? "upcoming",
            chatId: chatRow.id as string,
            customLocation: m.custom_location_name
              ? {
                  name: m.custom_location_name as string,
                  address: (m.custom_location_address as string) ?? undefined,
                }
              : undefined,
          }
        : null;
      setResolved({
        chat: {
          id: chatRow.id as string,
          meetupId: chatRow.meetup_id as string,
          participantIds: [],
          messages: [],
        },
        meetup,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isDb, authLoading, reloadKey]);

  // Load persisted messages + subscribe to realtime.
  useEffect(() => {
    if (!isDb || !id) return;
    if (authLoading) return;
    let cancelled = false;
    fetchMessages(id).then((msgs) => {
      if (!cancelled) setDbMessages(msgs);
    });
    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${id}` },
        (payload) => {
          const m = payload.new as Record<string, unknown>;
          setDbMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id as string,
                chatId: m.chat_id as string,
                senderId: (m.sender_id as string | null) ?? "system",
                body: m.body as string,
                createdAt: m.created_at as string,
                type: m.type as Message["type"],
              },
            ];
          });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id, isDb, authLoading, reloadKey]);

  const chat = resolved?.chat;
  const meetup = resolved?.meetup;
  const place = meetup ? getPlace(meetup.communityPlaceId) : undefined;
  const placeLabel = meetup?.location?.locationName ?? meetup?.customLocation?.name ?? place?.name;
  const placeAddr = meetup?.location?.address ?? meetup?.customLocation?.address ?? place?.address;

  const messages = useMemo(() => {
    if (isDb) {
      // Persisted messages + optimistic local echoes not yet reflected in realtime.
      return [
        ...dbMessages,
        ...localMessages.filter(
          (lm) => !dbMessages.some((dm) => dm.id === lm.id),
        ),
      ];
    }
    return [...(chat?.messages ?? []), ...localMessages];
  }, [chat, dbMessages, isDb, localMessages]);

  if (!chat || (!isDb && !meetup)) {
    return (
      <div className="flex flex-col min-h-dvh">
        <AppHeader
          title="Meetup chat"
          left={
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          }
        />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          {loadError ? (
            <>
              <p className="text-charcoal font-medium">{loadError}</p>
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
            </>
          ) : (
            <p className="text-charcoal font-medium">Loading chat…</p>
          )}
        </div>
      </div>
    );
  }


  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");

    if (isDb && id) {
      if (!profile?.id) return;
      const tempId = `local_${Date.now()}`;
      setLocalMessages((prev) => [
        ...prev,
        {
          id: tempId,
          chatId: id,
          senderId: profile.id,
          body,
          createdAt: new Date().toISOString(),
          type: "user",
        },
      ]);
      const saved = await sendMessage(id, profile.id, body);
      if (saved) {
        setLocalMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDbMessages((prev) =>
          prev.some((m) => m.id === saved.id) ? prev : [...prev, saved],
        );
      }
      return;
    }

    // Mock fallback
    setLocalMessages((prev) => [
      ...prev,
      {
        id: `local_${prev.length + 1}`,
        chatId: chat.id,
        senderId: currentUser.id,
        body,
        createdAt: new Date().toISOString(),
        type: "user",
      },
    ]);
  };

  const attendeeCount = meetup ? meetup.attendeeIds.length : 0;

  return (
    <div className="flex flex-col min-h-dvh bg-muted/20">
      <AppHeader
        title={meetup?.title ?? "Meetup chat"}
        subtitle={
          meetup
            ? `${formatMeetupDate(meetup.date)} · ${formatTime12h(meetup.startTime)}`
            : undefined
        }
        left={
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        }
      />

      {meetup && (
        <div className="px-4 pt-3">
          <Card padding="md" className="bg-soft-green/40 border-primary/20">
            <div className="text-[11px] font-semibold text-primary uppercase tracking-wider">
              Pinned
            </div>
            <div className="mt-1 text-sm font-semibold text-charcoal">
              See everyone {formatMeetupDate(meetup.date).toLowerCase()} at{" "}
              {formatTime12h(meetup.startTime)}.
            </div>
            <div className="mt-2 space-y-1.5 text-xs text-charcoal">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                <span>{formatMeetupDate(meetup.date)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>{formatTimeRange(meetup.startTime, meetup.endTime)}</span>
              </div>
              {placeLabel && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-primary mt-0.5" />
                  <span>
                    <span className="font-medium">{placeLabel}</span>
                    {placeAddr && (
                      <span className="text-charcoal-muted"> · {placeAddr}</span>
                    )}
                  </span>
                </div>
              )}
              {attendeeCount > 0 && (
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  <span>{attendeeCount} Veggies going</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      <div className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
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
          const sender = getVeggie(m.senderId);
          const isMe =
            m.senderId === currentUser.id ||
            (!!profile?.id && m.senderId === profile.id);
          return (
            <div
              key={m.id}
              className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}
            >
              {!isMe && sender && (
                <UserAvatar
                  name={sender.displayName}
                  src={sender.avatarUrl}
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
                {!isMe && sender && (
                  <div className="text-[11px] font-semibold mb-0.5 text-primary">
                    {sender.displayName}
                  </div>
                )}
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={handleSend}
        className="safe-bottom border-t border-border/60 p-3 flex items-center gap-2 bg-background"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Introduce yourself or ask a meetup question..."
          className="flex-1 h-11 rounded-full bg-muted px-4 text-sm outline-none placeholder:text-charcoal-muted focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
