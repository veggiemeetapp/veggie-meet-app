import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, ChevronRight, Plane, Plus, Trash2, Users } from "lucide-react";
import {
  AppHeader,
  BackButton,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  TertiaryButton,
} from "@/components/app";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveCities, useLocationContext } from "@/hooks/useLocation";
import { useDeleteTrip, useMyTrips, useUpsertTrip } from "@/hooks/useTrips";
import { formatTripRange, todayISODate, type Trip } from "@/lib/trips";
import { memberSafeMessage } from "@/lib/errors";

/**
 * My trips — "I'll be in <city> from <start> to <end>". A trip makes the
 * member show up in that city's Veggies-here list for those dates and shows
 * who else will be there. Nothing else about the profile changes.
 */
export default function MyTrips() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tripsQ = useMyTrips();
  const citiesQ = useActiveCities();
  const location = useLocationContext();
  const homeCityId = location.data?.home_city?.id ?? null;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [cityId, setCityId] = useState("");
  const [start, setStart] = useState(todayISODate());
  const [end, setEnd] = useState(todayISODate(6));
  const [note, setNote] = useState("");

  const upsert = useUpsertTrip();
  const remove = useDeleteTrip();

  // Deep link `/you/trips?add=<cityId>` from the Veggies-here screen.
  useEffect(() => {
    const add = params.get("add");
    if (add) {
      setEditing(null);
      setCityId(add);
      setStart(todayISODate());
      setEnd(todayISODate(6));
      setNote("");
      setOpen(true);
      params.delete("add");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const cities = useMemo(
    () => (citiesQ.data ?? []).filter((c) => c.id !== homeCityId),
    [citiesQ.data, homeCityId],
  );

  const openNew = () => {
    setEditing(null);
    setCityId("");
    setStart(todayISODate());
    setEnd(todayISODate(6));
    setNote("");
    setOpen(true);
  };

  const openEdit = (t: Trip) => {
    setEditing(t);
    setCityId(t.city_id);
    setStart(t.start_date);
    setEnd(t.end_date);
    setNote(t.note ?? "");
    setOpen(true);
  };

  const submit = () => {
    if (!cityId) {
      toast.error("Choose a city.");
      return;
    }
    if (!start || !end) {
      toast.error("Choose your travel dates.");
      return;
    }
    if (end < start) {
      toast.error("The end date must be after the start date.");
      return;
    }
    upsert.mutate(
      { cityId, startDate: start, endDate: end, note, tripId: editing?.id ?? null },
      {
        onSuccess: (id) => {
          setOpen(false);
          toast.success(editing ? "Trip updated." : "Trip added.");
          if (!editing) navigate(`/trips/${id}`);
        },
        onError: (e) => toast.error(memberSafeMessage(e)),
      },
    );
  };

  const confirmDelete = (t: Trip) => {
    if (!window.confirm(`Remove your trip to ${t.city_name}?`)) return;
    remove.mutate(t.id, {
      onSuccess: () => toast.success("Trip removed."),
      onError: (e) => toast.error(memberSafeMessage(e)),
    });
  };

  const trips = tripsQ.data ?? [];

  return (
    <div className="pb-16 animate-fade-in">
      <AppHeader
        left={<BackButton fallback="/you" />}
        title="My Trips"
        subtitle="Let veggies know when you're in town"
        right={
          <button
            type="button"
            onClick={openNew}
            aria-label="Add a trip"
            className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <Plus className="w-5 h-5" />
          </button>
        }
      />

      <div className="px-5 mt-2 space-y-4">
        {tripsQ.isPending ? (
          <p className="text-sm text-charcoal-muted">Loading…</p>
        ) : tripsQ.isError ? (
          <EmptyState
            icon={<Plane className="w-6 h-6" />}
            title="We couldn't load your trips."
            description={memberSafeMessage(tripsQ.error)}
            action={<SecondaryButton size="sm" onClick={() => tripsQ.refetch()}>Try again</SecondaryButton>}
          />
        ) : trips.length === 0 ? (
          <EmptyState
            icon={<Plane className="w-6 h-6" />}
            title="No upcoming trips"
            description="Add where you're heading next. You'll appear in that city's Veggies list for those dates, and you'll see who else will be there."
            action={
              <PrimaryButton size="sm" onClick={openNew}>
                <Plus className="w-4 h-4" /> Add a trip
              </PrimaryButton>
            }
          />
        ) : (
          <ul className="space-y-3">
            {trips.map((t) => (
              <li key={t.id}>
                <Card padding="md" className="space-y-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/trips/${t.id}`)}
                    className="w-full text-left flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-card"
                  >
                    <div className="w-10 h-10 rounded-card bg-soft-green text-primary flex items-center justify-center shrink-0">
                      <Plane className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-charcoal truncate">{t.city_name}</span>
                        {t.is_current && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                            Now
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-charcoal-muted inline-flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" aria-hidden />
                        {formatTripRange(t.start_date, t.end_date)}
                      </div>
                      <div className="text-xs text-charcoal-muted inline-flex items-center gap-1 ml-2">
                        <Users className="w-3 h-3" aria-hidden />
                        {t.overlap_count} {t.overlap_count === 1 ? "veggie" : "veggies"} there
                      </div>
                      {t.note && <p className="text-xs text-charcoal mt-1 line-clamp-2">{t.note}</p>}
                    </div>
                    <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
                  </button>
                  <div className="flex gap-2">
                    <TertiaryButton size="sm" onClick={() => openEdit(t)}>
                      Edit
                    </TertiaryButton>
                    <TertiaryButton
                      size="sm"
                      onClick={() => confirmDelete(t)}
                      disabled={remove.isPending}
                      aria-label={`Remove trip to ${t.city_name}`}
                    >
                      <Trash2 className="w-4 h-4" /> Remove
                    </TertiaryButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-t border-border p-0">
          <SheetHeader className="page-x pt-6 pb-2 text-left">
            <SheetTitle className="text-lg font-semibold text-charcoal">
              {editing ? "Edit trip" : "Add a trip"}
            </SheetTitle>
            <SheetDescription className="text-sm text-charcoal-muted">
              Only the city and dates are shared. Veggies in that city will see you're visiting.
            </SheetDescription>
          </SheetHeader>
          <div className="page-x pb-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="trip-city">City</Label>
              <Select value={cityId} onValueChange={setCityId}>
                <SelectTrigger id="trip-city" aria-label="City">
                  <SelectValue placeholder="Choose a city" />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cities.length === 0 && !citiesQ.isPending && (
                <p className="text-xs text-charcoal-muted">No other cities are live yet.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="trip-start">From</Label>
                <Input
                  id="trip-start"
                  type="date"
                  value={start}
                  min={todayISODate(-1)}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (end < e.target.value) setEnd(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trip-end">To</Label>
                <Input
                  id="trip-end"
                  type="date"
                  value={end}
                  min={start || todayISODate()}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trip-note">Note (optional)</Label>
              <Textarea
                id="trip-note"
                value={note}
                maxLength={140}
                rows={2}
                placeholder="e.g. Keen for a vegan pho crawl and a beach morning"
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="text-[11px] text-charcoal-muted text-right">{note.length}/140</p>
            </div>
            <PrimaryButton fullWidth onClick={submit} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : editing ? "Save changes" : "Add trip"}
            </PrimaryButton>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
