import { MapPin, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { CommunityPlace } from "@/types";
import { Card } from "./Card";
import { usePlaceCoverUrl } from "@/hooks/usePlacePhotos";
import { PlaceCoverImage } from "@/components/place/PlaceCoverImage";

interface Props {
  place: CommunityPlace;
}

const categoryLabel: Record<CommunityPlace["category"], string> = {
  restaurant: "Restaurant",
  cafe: "Café",
  park: "Park",
  market: "Market",
  studio: "Studio",
  venue: "Venue",
};

export function CommunityPlaceCard({ place }: Props) {
  const navigate = useNavigate();
  // WO-101: owner-managed cover photo, neutral placeholder when absent.
  const coverUrl = usePlaceCoverUrl(place.id);
  return (
    <Card padding="none" interactive onClick={() => navigate(`/place/${place.id}`)} className="overflow-hidden w-60 shrink-0">
      <div className="relative h-36">
        {coverUrl ? <PlaceCoverImage coverUrl={coverUrl} /> : (
          <div className="w-full h-full bg-soft-green flex items-center justify-center">
            <MapPin className="w-6 h-6 text-primary/70" aria-hidden />
          </div>
        )}
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-background/90 backdrop-blur text-charcoal">
          {categoryLabel[place.category]}
        </span>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-charcoal text-sm leading-tight line-clamp-1">
          {place.name}
        </h3>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-charcoal-muted truncate">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{place.address}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="font-medium text-primary">
            {place.meetupsThisMonth} meetups this month
          </span>
          <span className="flex items-center gap-1 text-charcoal-muted">
            <Users className="w-3 h-3" />
            {place.veggiesVisitedCount}
          </span>
        </div>
      </div>
    </Card>
  );
}
