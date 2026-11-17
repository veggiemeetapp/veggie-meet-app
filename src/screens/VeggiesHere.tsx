import { useNavigate } from "react-router-dom";
import { Plane } from "lucide-react";
import { AppHeader, BackButton, Card, SecondaryButton } from "@/components/app";
import { VeggiePresenceList } from "@/components/veggies/VeggiePresenceList";
import { useLocationContext } from "@/hooks/useLocation";
import { useMyTrips } from "@/hooks/useTrips";

/**
 * Veggies here — everyone in the selected city today: members who live there
 * plus members visiting on a trip. The NomadTable-style "who's here now" list.
 */
export default function VeggiesHere() {
  const navigate = useNavigate();
  const location = useLocationContext();
  const city = location.data?.selected_city ?? location.data?.home_city ?? null;
  const homeCity = location.data?.home_city ?? null;
  const tripsQ = useMyTrips();
  const hasTripHere = (tripsQ.data ?? []).some((t) => t.city_id === city?.id);
  const isMyHome = !!city && !!homeCity && city.id === homeCity.id;

  return (
    <div className="pb-16 animate-fade-in">
      <AppHeader
        left={<BackButton fallback="/community" />}
        title={city ? `Veggies in ${city.name}` : "Veggies here"}
        subtitle="Living here or visiting right now"
      />
      <div className="px-5 mt-2 space-y-4">
        {city && !isMyHome && !hasTripHere && !tripsQ.isPending && (
          <Card padding="md" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-card bg-soft-green text-primary flex items-center justify-center shrink-0">
              <Plane className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-charcoal">Visiting {city.name}?</div>
              <div className="text-xs text-charcoal-muted">
                Add your dates so veggies here can find you.
              </div>
            </div>
            <SecondaryButton size="sm" onClick={() => navigate(`/you/trips?add=${city.id}`)}>
              Add trip
            </SecondaryButton>
          </Card>
        )}

        {location.isPending ? null : !city ? (
          <Card padding="md" className="text-sm text-charcoal-muted">
            Choose a city first to see who's around.
            <div className="mt-3">
              <SecondaryButton size="sm" onClick={() => navigate("/community")}>
                Pick a city
              </SecondaryButton>
            </div>
          </Card>
        ) : (
          <VeggiePresenceList
            source={{ kind: "city", cityId: city.id }}
            cityName={city.name}
            emptyAction={
              <SecondaryButton size="sm" onClick={() => navigate("/host")}>
                Host a meetup
              </SecondaryButton>
            }
          />
        )}
      </div>
    </div>
  );
}
