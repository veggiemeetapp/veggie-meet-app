import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Home, Users, PlusCircle, MessageCircle, User, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchInbox } from "@/lib/directMessages";

export interface BottomNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const defaultNavItems: BottomNavItem[] = [
  { label: "Today", to: "/", icon: Home },
  { label: "Community", to: "/community", icon: Users },
  { label: "Host", to: "/host", icon: PlusCircle },
  { label: "Chats", to: "/chats", icon: MessageCircle },
  { label: "You", to: "/you", icon: User },
];

interface BottomNavProps {
  items?: BottomNavItem[];
}

function useUnreadConversations() {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    const refresh = () =>
      fetchInbox()
        .then((rows) => {
          if (!cancelled) setCount(rows.filter((r) => r.unreadCount > 0).length);
        })
        .catch(() => {});
    refresh();
    const channel = supabase
      .channel(`bottom-nav-unread-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dm_messages" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);
  return count;
}

export function BottomNav({ items = defaultNavItems }: BottomNavProps) {
  const unread = useUnreadConversations();
  return (
    <nav
      aria-label="Primary"
      className="safe-bottom fixed bottom-0 inset-x-0 z-40 mx-auto max-w-phone bg-card/95 backdrop-blur-xl border-t border-border"
    >
      <ul className="flex items-stretch justify-around px-2 pt-1.5 pb-1.5">
        {items.map(({ label, to, icon: Icon }) => {
          const showBadge = to === "/chats" && unread > 0;
          return (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "relative flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl min-h-[3.25rem] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                    isActive
                      ? "text-primary"
                      : "text-charcoal-muted hover:text-charcoal",
                  )
                }
                // WO-085 (WCAG 4.1.2): NavLink already emits aria-current="page"
                // when active, so the active tab is exposed programmatically and
                // not by colour alone. The unread count is spoken as part of the
                // item name rather than as a bare visual dot (see item 70).
                aria-label={

                  showBadge
                    ? `${label}, ${unread} unread ${unread === 1 ? "conversation" : "conversations"}`
                    : undefined
                }
              >
                <div className="relative">
                  <Icon className="w-6 h-6" aria-hidden="true" />
                  {showBadge && (
                    <span
                      className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
                      aria-hidden="true"
                    >
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium">{label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>

    </nav>
  );
}
