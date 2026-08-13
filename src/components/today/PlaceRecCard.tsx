import { useNavigate } from "react-router-dom";
import { MapPin, Leaf } from "lucide-react";
import { Card } from "@/components/app/Card";
import { ReasonPill } from "./ReasonPill";
import { RecCardMenu } from "./RecCardMenu";
import { usePlaceCoverUrl } from "@/hooks/usePlacePhotos";
import type { PlaceRecommendation } from "@/lib/today";

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
  return (
    <Card padding="none" interactive className="w-60 shrink-0 overflow-hidden">
      <div className="relative h-32">
        <button onClick={go} className="block w-full h-full" aria-label={`View ${place.name}`}>
          <img
            src={place.cover_image_url ?? "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&q=80"}
            alt=""
            className="w-full h-full object-cover bg-muted"
            loading="lazy"
          />
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
