import { useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  REACTION_EMOJIS,
  reactionName,
  reactionPillLabel,
  type MessageReaction,
} from "@/lib/chatReactions";

/**
 * WO-137 — compact reaction pills plus an author-agnostic “Add reaction”
 * picker. Reaction eligibility is decided by the caller (never rendered for
 * tombstones, system messages or unreadable chats) and every toggle is
 * re-authorized server-side.
 */
export function ReactionPills({
  reactions,
  onToggle,
  messageLabel,
  align = "start",
}: {
  reactions: MessageReaction[];
  onToggle: (emoji: string) => void;
  messageLabel: string;
  align?: "start" | "end";
}) {
  if (reactions.length === 0) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap gap-1 mt-1",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          data-reaction-pill={r.emoji}
          aria-pressed={r.mine}
          aria-label={`${reactionPillLabel(r)}. ${messageLabel}`}
          onClick={() => onToggle(r.emoji)}
          className={cn(
            "inline-flex items-center gap-1 min-h-[28px] px-2 rounded-full border text-xs font-semibold transition-colors motion-reduce:transition-none",
            r.mine
              ? "border-primary bg-soft-green text-primary"
              : "border-border bg-card text-charcoal-muted hover:bg-muted",
          )}
        >
          <span aria-hidden="true" className="text-sm leading-none">
            {r.emoji}
          </span>
          <span aria-hidden="true">{r.count}</span>
          {r.mine && (
            <span aria-hidden="true" className="text-[10px] font-bold">
              ✓
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function AddReactionButton({
  onSelect,
  messageLabel,
  selected,
  className,
}: {
  onSelect: (emoji: string) => void;
  messageLabel: string;
  selected: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = (i: number) => {
    const list = itemsRef.current.filter(Boolean) as HTMLButtonElement[];
    if (list.length === 0) return;
    const next = (i + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-add-reaction
          aria-label={`Add reaction to ${messageLabel}`}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center text-charcoal-muted hover:bg-muted",
            className,
          )}
        >
          <SmilePlus className="w-4 h-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="top"
        collisionPadding={12}
        className="w-auto max-w-[calc(100vw-24px)] p-1.5"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusAt(0);
        }}
      >
        <div role="group" aria-label="Choose a reaction" className="flex flex-wrap gap-1">
          {REACTION_EMOJIS.map((r, i) => (
            <button
              key={r.emoji}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              data-reaction-option={r.emoji}
              aria-label={r.name}
              aria-pressed={selected.includes(r.emoji)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  focusAt(i + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  focusAt(i - 1);
                }
              }}
              onClick={() => {
                onSelect(r.emoji);
                setOpen(false);
              }}
              className={cn(
                "w-11 h-11 rounded-full flex items-center justify-center text-xl hover:bg-muted",
                selected.includes(r.emoji) && "bg-soft-green ring-1 ring-primary",
              )}
            >
              <span aria-hidden="true">{r.emoji}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { reactionName };
