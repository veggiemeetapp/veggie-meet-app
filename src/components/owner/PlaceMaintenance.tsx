import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  MAINTENANCE_STATUS_LABEL,
  fetchMaintenancePlaces,
  fetchPlaceStatusHistory,
  reverifyPlace,
  setPlaceStatus,
} from "@/lib/placeMaintenance";
import type { CommunityPlaceMaintenanceStatus } from "@/types";

const STATUS_OPTIONS: CommunityPlaceMaintenanceStatus[] = [
  "operational",
  "needs_reverification",
  "temporarily_closed",
  "permanently_closed",
];

const STATUS_TONE: Record<CommunityPlaceMaintenanceStatus, string> = {
  operational: "bg-primary/10 text-primary",
  needs_reverification: "bg-amber-500/15 text-amber-700",
  temporarily_closed: "bg-amber-500/15 text-amber-700",
  permanently_closed: "bg-destructive/10 text-destructive",
};

/**
 * WO-053 — Owner-only status maintenance for published Community Places.
 * Presentation only: every action is re-authorised and validated server-side.
 */
export function PlaceMaintenance() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<CommunityPlaceMaintenanceStatus>("operational");
  const [note, setNote] = useState("");

  const placesQ = useQuery({
    queryKey: ["place-maintenance"],
    queryFn: fetchMaintenancePlaces,
  });

  const historyQ = useQuery({
    queryKey: ["place-status-history", openId],
    queryFn: () => fetchPlaceStatusHistory(openId as string),
    enabled: !!openId,
  });

  const selected = useMemo(
    () => placesQ.data?.find((p) => p.id === openId) ?? null,
    [placesQ.data, openId],
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["place-maintenance"] });
    qc.invalidateQueries({ queryKey: ["place-status-history"] });
    qc.invalidateQueries({ queryKey: ["community-places"] });
    qc.invalidateQueries({ queryKey: ["community-place"] });
  }

  const statusM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No place selected");
      await setPlaceStatus(selected.id, status, note.trim() || null);
    },
    onSuccess: () => {
      setNote("");
      invalidate();
      toast.success("Status updated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverifyM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No place selected");
      await reverifyPlace(selected.id, note.trim());
    },
    onSuccess: () => {
      setNote("");
      invalidate();
      toast.success("Reverification recorded. Place is operational again.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-2 min-w-0">
      <h2 className="text-sm font-semibold">
        Published place maintenance ({placesQ.data?.length ?? 0})
      </h2>
      <p className="text-[11px] text-muted-foreground">
        Change a published place's status when it closes or needs its vegan verification
        reviewed again. Non-operational places can't be chosen for new Meetups or checked into.
      </p>

      {placesQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {placesQ.error && (
        <p className="text-sm text-destructive">
          {(placesQ.error as Error).message}
        </p>
      )}

      <ul className="space-y-1.5 list-none p-0 m-0">
        {(placesQ.data ?? []).map((p) => {
          const open = p.id === openId;
          return (
            <li key={p.id} className="min-w-0 rounded-lg border">
              <button
                type="button"
                onClick={() => {
                  const next = open ? null : p.id;
                  setOpenId(next);
                  setNote("");
                  setStatus(p.maintenance_status);
                }}
                className={`w-full text-left p-3 min-w-0 transition-colors ${
                  open ? "bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <span className="text-sm font-medium line-clamp-2 [overflow-wrap:anywhere]">
                    {p.name}
                  </span>
                  <span
                    className={`text-[11px] shrink-0 rounded-full px-2 py-0.5 ${
                      STATUS_TONE[p.maintenance_status]
                    }`}
                  >
                    {MAINTENANCE_STATUS_LABEL[p.maintenance_status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 [overflow-wrap:anywhere]">
                  {p.neighborhood ?? "—"} · {p.upcoming_meetups_here} upcoming Meetup
                  {p.upcoming_meetups_here === 1 ? "" : "s"} here
                  {p.is_active ? "" : " · hidden from discovery"}
                </p>
                {p.status_note && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3 [overflow-wrap:anywhere]">
                    Note: {p.status_note}
                  </p>
                )}
              </button>

              {open && selected && (
                <div className="border-t p-3 space-y-3 min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_OPTIONS.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={status === s ? "default" : "outline"}
                        onClick={() => setStatus(s)}
                      >
                        {MAINTENANCE_STATUS_LABEL[s]}
                      </Button>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`note-${p.id}`}>
                      Reason note {status === "operational" ? "(optional)" : "(required)"}
                    </Label>
                    <Textarea
                      id={`note-${p.id}`}
                      rows={2}
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why is this status changing? Shown to members when the place isn't operational."
                    />
                  </div>

                  {p.upcoming_meetups_here > 0 && status !== "operational" && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                      {p.upcoming_meetups_here} upcoming Meetup
                      {p.upcoming_meetups_here === 1 ? " is" : "s are"} scheduled here.
                      Existing Meetups are not cancelled — hosts should move them to a new location.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => statusM.mutate()}
                      disabled={
                        statusM.isPending ||
                        (status !== "operational" && note.trim().length === 0)
                      }
                    >
                      {statusM.isPending ? "Saving…" : "Save status"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reverifyM.mutate()}
                      disabled={reverifyM.isPending || note.trim().length === 0}
                    >
                      {reverifyM.isPending ? "Recording…" : "Mark reverified"}
                    </Button>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium">Status history</p>
                    {historyQ.isLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {historyQ.data?.length === 0 && (
                      <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
                    )}
                    <ul className="space-y-1 list-none p-0 m-0">
                      {(historyQ.data ?? []).map((h) => (
                        <li
                          key={h.id}
                          className="text-xs text-muted-foreground min-w-0 [overflow-wrap:anywhere]"
                        >
                          {new Date(h.created_at).toLocaleString()} —{" "}
                          {h.old_status ?? "—"} → {h.new_status} ({h.action})
                          {h.note ? `: ${h.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
