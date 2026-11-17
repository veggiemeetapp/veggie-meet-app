import { useNavigate, useParams } from "react-router-dom";
import { AppHeader, BackButton, Card, SecondaryButton } from "@/components/app";
import { VeggiePresenceList } from "@/components/veggies/VeggiePresenceList";
import { useMyTrips } from "@/hooks/useTrips";
import { formatTripRange } from "@/lib/trips";

/** Who will be in the city while I'm there (one of my trips). */
export default function TripOverlaps() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const tripsQ = useMyTrips();
  const trip = (tripsQ.data ?? []).find((t) => t.id === id) ?? null;

  return (
    <div className="pb-16 animate-fade-in">
      <AppHeader
        left={<BackButton fallback="/you/trips" />}
        title={trip ? `Veggies in ${trip.city_name}` : "Your trip"}
        subtitle={trip ? `While you're there, ${formatTripRange(trip.start_date, trip.end_date)}` : undefined}
      />
      <div className="px-5 mt-2 space-y-4">
        {tripsQ.isPending ? null : !trip ? (
          <Card padding="md" className="text-sm text-charcoal-muted">
            We couldn't find that trip.
            <div className="mt-3">
              <SecondaryButton size="sm" onClick={() => navigate("/you/trips")}>
                My trips
              </SecondaryButton>
            </div>
          </Card>
        ) : (
          <VeggiePresenceList
            source={{ kind: "trip", tripId: trip.id }}
            cityName={trip.city_name}
            emptyAction={
              <SecondaryButton size="sm" onClick={() => navigate("/host")}>
                Host a meetup there
              </SecondaryButton>
            }
          />
        )}
      </div>
    </div>
  );
}
