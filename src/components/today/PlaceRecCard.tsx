import { useNavigate } from "react-router-dom";
import { MapPin, Leaf } from "lucide-react";
import { Card } from "@/components/app/Card";
import { ReasonPill } from "./ReasonPill";
import { RecCardMenu } from "./RecCardMenu";
import { usePlaceCoverUrl } from "@/hooks/usePlacePhotos";
import type { PlaceRecommendation } from "@/lib/today";
import { PlaceCoverImage } from "@/components/place/PlaceCoverImage";

interface Props {
  place: PlaceRecommendation;
}

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

export function PlaceRecCard({ place }: Props) {
  const navigate = useNavigate();
  const go = () => navigate(`/place/${place.entity_id}`);
  // WO-101: owner-managed cover photo, with a neutral placeholder when a place
  // has none. No stock imagery is substituted for a real venue any more.
  const coverUrl = usePlaceCoverUrl(place.entity_id);
  return (
    <Card padding="none" interactive className="w-60 shrink-0 overflow-hidden">
      <div className="relative h-32">
        <button onClick={go} className="block w-full h-full" aria-label={`View ${place.name}`}>
          {coverUrl ? <PlaceCoverImage coverUrl={coverUrl} /> : (
            <span className="w-full h-full bg-soft-green flex items-center justify-center">
              <Leaf className="w-7 h-7 text-primary/70" aria-hidden />
            </span>
          )}
        </button>
        <span className="absolute top-2 left-2 rounded-full bg-background/90 backdrop-blur px-2 py-0.5 text-[10px] font-semibold text-charcoal">
          {CATEGORY_LABEL[place.category] ?? place.category}
        </span>
        <div className="absolute top-2 right-2">
          <RecCardMenu
            entityType="place"
            entityId={place.entity_id}
            reasonCode={place.reason_code}
            label={place.name}
          />
        </div>
      </div>
      <button onClick={go} className="block text-left w-full p-3">
        <h3 className="font-semibold text-charcoal text-sm line-clamp-1">{place.name}</h3>
        {place.address && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-charcoal-muted truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{place.address}</span>
          </div>
        )}
        <div className="mt-2">
          <ReasonPill label={place.reason_label} />
        </div>
      </button>
    </Card>
  );
}
