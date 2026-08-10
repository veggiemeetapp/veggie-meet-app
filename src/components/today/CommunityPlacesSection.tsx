import type { CommunityPlace } from "@/types";
import { CommunityPlaceCard, SectionHeader } from "@/components/app";

interface Props {
  places: CommunityPlace[];
}

export function CommunityPlacesSection({ places }: Props) {
  return (
    <section>
      <SectionHeader
        title="Community Places"
        subtitle="Where Veggies love to gather"
      />
      <div
        className="rail flex gap-3 px-5 overflow-x-auto scrollbar-none pb-2"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {places.map((p) => (
          <div key={p.id} style={{ scrollSnapAlign: "start" }}>
            <CommunityPlaceCard place={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
