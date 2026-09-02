import { useQuery } from "@tanstack/react-query";
import { Ticket } from "lucide-react";
import { fetchViewerInvitationNote } from "@/lib/invitations";

interface Props {
  meetupId: string;
  viewerProfileId?: string | null;
}

/**
 * WO-144A addendum (DEF-144A-01) — private, recipient-only invitation note.
 *
 * The host's optional personal message is delivered here for network
 * invitations (which have no conversation). It is rendered strictly as text by
 * React, never as markup, and the underlying row is readable only by the
 * invitation's sender and recipient.
 */
export function InvitationNote({ meetupId, viewerProfileId }: Props) {
  const { data } = useQuery({
    queryKey: ["viewer-invitation-note", meetupId, viewerProfileId ?? null],
    enabled: !!viewerProfileId,
    queryFn: () => fetchViewerInvitationNote(meetupId, viewerProfileId!),
  });

  if (!data) return null;

  return (
    <section
      className="rounded-card border border-primary/30 bg-soft-green/60 p-4"
      aria-label="Your invitation"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <Ticket className="w-3 h-3" aria-hidden="true" />
        Invitation from {data.senderName}
      </div>
      <p className="mt-1.5 text-sm text-charcoal whitespace-pre-wrap break-words">
        {data.personalMessage}
      </p>
      <p className="mt-2 text-[11px] text-charcoal-muted">
        Only you and your host can see this message.
      </p>
    </section>
  );
}
