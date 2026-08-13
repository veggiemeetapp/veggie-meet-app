import { useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MAINTENANCE_STATUS_LABEL,
  fetchMaintenancePlaces,
  fetchPlaceStatusHistory,
  reverifyPlace,
  setPlaceStatus,
} from "@/lib/placeMaintenance";
import type { CommunityPlaceMaintenanceStatus } from "@/types";

const STATUS_OPTIONS: CommunityPlaceMaintenanceStatus[] = [
  "needs_reverification",
  "temporarily_closed",
  "permanently_closed",
];

const STATUS_TONE: Record<CommunityPlaceMaintenanceStatus, string> = {
  operational: "bg-soft-green text-primary",
  needs_reverification: "bg-warning-soft text-warning",
  temporarily_closed: "bg-warning-soft text-warning",
  permanently_closed: "bg-destructive/10 text-destructive",
};

const CLASSIFICATIONS: { value: string; label: string }[] = [
  { value: "fully_vegan", label: "100% Vegan" },
  { value: "fully_vegetarian", label: "100% Vegetarian" },
  { value: "vegetarian_friendly", label: "Vegetarian friendly" },
  { value: "vegan_options", label: "Vegan options" },
  { value: "not_food", label: "Community space" },
];

const IMPACT_COPY: Record<CommunityPlaceMaintenanceStatus, string> = {
  operational: "",
  needs_reverification:
    "The place is removed from discovery, search and the Host picker while its vegan verification is reviewed. Check-ins are blocked. The place page stays reachable with a review banner. Returning it to operational requires Mark reverified.",
  temporarily_closed:
    "The place is removed from discovery, search and the Host picker. No new Meetups can be hosted here and check-ins are blocked. The place page stays reachable with a closed banner. Returning it to operational requires Mark reverified.",
  permanently_closed:
    "This is destructive: the place is hidden from all discovery and search permanently. No new hosting or check-ins. The place page stays reachable as a read-only historical record. Prior member support already earned stays counted.",
};

/** Human labels for history rows — internal enum values are never shown. */
function statusLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return (
    MAINTENANCE_STATUS_LABEL[raw as CommunityPlaceMaintenanceStatus] ??
    raw.replace(/_/g, " ")
  );
}

const ACTION_LABEL: Record<string, string> = {
  status_change: "status change",
  reverification: "reverification",
  reverified: "reverification",
  publish: "published",
};

function actionLabel(raw: string): string {
  return ACTION_LABEL[raw] ?? raw.replace(/_/g, " ");
}

/**
 * WO-053 — Owner-only status maintenance for published Community Places.
 * Presentation only: every action is re-authorised and validated server-side.
 */
export function PlaceMaintenance() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<CommunityPlaceMaintenanceStatus>("needs_reverification");
  const [note, setNote] = useState("");
  const [classification, setClassification] = useState<string>("fully_vegan");
  const [confirm, setConfirm] = useState<null | "status" | "reverify">(null);
  /** Element that opened the confirmation dialog — focus returns here on close. */
  const triggerRef = useRef<HTMLElement | null>(null);

  function openConfirm(kind: "status" | "reverify", e: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = e.currentTarget;
    setConfirm(kind);
  }

  function closeConfirm() {
    setConfirm(null);
    const el = triggerRef.current;
    if (el) requestAnimationFrame(() => el.focus());
  }

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
    qc.invalidateQueries({ queryKey: ["host-published-places"] });
    qc.invalidateQueries({ queryKey: ["manage-places"] });
  }

  const statusM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No place selected");
      await setPlaceStatus(selected.id, status, note.trim() || null);
    },
    onSuccess: () => {
      setNote("");
      closeConfirm();
      invalidate();
      toast.success("Status updated.");
    },
    onError: (e: Error) => {
      closeConfirm();
      toast.error(e.message);
    },
  });

  const reverifyM = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No place selected");
      await reverifyPlace(selected.id, note.trim(), classification);
    },
    onSuccess: () => {
      setNote("");
      closeConfirm();
      invalidate();
      toast.success("Reverification recorded. Place is operational again.");
    },
    onError: (e: Error) => {
      closeConfirm();
      toast.error(e.message);
    },
  });

  const pending = statusM.isPending || reverifyM.isPending;

  return (
    <section className="space-y-2 min-w-0">
      <h2 className="text-sm font-semibold">
        Published place maintenance ({placesQ.data?.length ?? 0})
      </h2>
      <p className="text-[11px] text-muted-foreground">
        Change a published place's status when it closes or needs its vegan verification
        reviewed again. Non-operational places are hidden from discovery, search and the Host
        picker, and can't be checked into — their place page stays reachable with a banner.
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
            <li key={p.id} className="min-w-0 rounded-control border">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  const next = open ? null : p.id;
                  setOpenId(next);
                  setNote("");
                  setStatus(
                    p.maintenance_status === "operational"
                      ? "needs_reverification"
                      : p.maintenance_status,
                  );
                  setClassification(p.veggie_classification ?? "fully_vegan");
                }}
                className={`w-full text-left p-3 min-w-0 transition-colors ${
                  open ? "bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
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
                  {p.maintenance_status === "operational" ? "" : " · hidden from discovery"}
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
                    <Label htmlFor={`note-${p.id}`}>Owner reason note (required)</Label>
                    <Textarea
                      id={`note-${p.id}`}
                      rows={2}
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why is this status changing? Kept internal — members only see a neutral status banner."
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Internal only. Never shown publicly.
                    </p>
                  </div>

                  {p.upcoming_meetups_here > 0 && (
                    <div className="rounded-control border border-warning-border bg-warning-soft/60 p-3 text-xs [overflow-wrap:anywhere]">
                      <AlertTriangle className="inline h-3.5 w-3.5 mr-1 align-[-2px]" aria-hidden />
                      {p.upcoming_meetups_here} upcoming Meetup
                      {p.upcoming_meetups_here === 1 ? " is" : "s are"} scheduled here.
                      Existing Meetups are never cancelled or moved — each host is notified once
                      that the location needs attention.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={status === "permanently_closed" ? "destructive" : "default"}
                      onClick={(e) => openConfirm("status", e)}
                      disabled={pending || note.trim().length === 0}
                    >
                      {statusM.isPending
                        ? "Saving…"
                        : `Set ${MAINTENANCE_STATUS_LABEL[status].toLowerCase()}`}
                    </Button>
                    {/* WO-057 — owner-only public detail corrections. */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/owner/places/${p.id}/photos?from=owner_places`)}
                    >
                      Manage photos
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/owner/places/${p.id}/edit?from=owner_places`)}
                    >
                      Edit public details
                    </Button>
                    {/* WO-058 / WO-058A — owner-only vegan verification review. A place
                        whose 100% Vegan status was revoked is reconfirmed and restored
                        through the same workspace. */}
                    <Button
                      size="sm"
                      variant={
                        p.veggie_classification === "not_confirmed_fully_vegan"
                          ? "default"
                          : "outline"
                      }
                      aria-label={
                        p.veggie_classification === "not_confirmed_fully_vegan"
                          ? `Reconfirm and restore the vegan status of ${p.name}`
                          : `Review the vegan status of ${p.name}`
                      }
                      onClick={() =>
                        navigate(`/owner/places/${p.id}/vegan-review?source=place_maintenance`)
                      }
                    >
                      {p.veggie_classification === "not_confirmed_fully_vegan"
                        ? "Reconfirm vegan status"
                        : "Review vegan status"}
                    </Button>
                    {/* WO-059 — owner-only identity replacement and relocation. */}
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Review the identity or location of ${p.name}`}
                      onClick={() =>
                        navigate(
                          `/owner/places/${p.id}/identity-review?source=place_maintenance`,
                        )
                      }
                    >
                      Review place identity
                    </Button>
                  </div>




                  <div className="rounded-control border p-3 space-y-2">
                    <p className="text-xs font-medium">Restore through reverification</p>
                    <p className="text-[11px] text-muted-foreground">
                      A place can only return to operational here — a casual status toggle back is
                      refused. Requires an owner note and a confirmed vegan classification.
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor={`class-${p.id}`}>Confirmed vegan classification</Label>
                      <select
                        id={`class-${p.id}`}
                        value={classification}
                        onChange={(e) => setClassification(e.target.value)}
                        className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                      >
                        {CLASSIFICATIONS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => openConfirm("reverify", e)}
                      disabled={pending || note.trim().length === 0}
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
                          {statusLabel(h.old_status)} → {statusLabel(h.new_status)} (
                          {actionLabel(h.action)}){h.note ? `: ${h.note}` : ""}
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

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) closeConfirm();
        }}
      >
        <AlertDialogContent className="max-w-[min(92vw,32rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              {confirm === "reverify"
                ? "Reverify this place?"
                : status === "permanently_closed"
                  ? "Permanently close this place?"
                  : `Set status to ${MAINTENANCE_STATUS_LABEL[status].toLowerCase()}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {confirm === "reverify" ? (
                <>
                  {selected?.name} returns to discovery, search, the Host picker, hosting and
                  check-in. The confirmed classification and reverification date are recorded in
                  status history.
                </>
              ) : (
                <>
                  {selected?.name}: {IMPACT_COPY[status]}
                  {selected && selected.upcoming_meetups_here > 0 && (
                    <>
                      {" "}
                      {selected.upcoming_meetups_here} upcoming Meetup
                      {selected.upcoming_meetups_here === 1 ? "" : "s"} linked here will stay
                      scheduled; the host is notified to update the location.
                    </>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className={
                confirm === "status" && status === "permanently_closed"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "reverify") reverifyM.mutate();
                else statusM.mutate();
              }}
            >
              {confirm === "reverify"
                ? "Mark reverified"
                : status === "permanently_closed"
                  ? "Permanently close"
                  : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
