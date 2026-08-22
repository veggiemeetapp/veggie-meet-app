// TEMPORARY WO-125 QA harness — deleted before closeout.
import { MeetupInterestTags } from "@/components/meetup";

export default function Wo125Harness() {
  return (
    <div className="px-5 py-6 space-y-8">
      <div data-case="primary-plus-two">
        <MeetupInterestTags
          primaryInterestId="coffee"
          additionalInterestIds={["vegan_food", "board_games"]}
        />
      </div>
      <div data-case="primary-only">
        <MeetupInterestTags primaryInterestId="coffee" additionalInterestIds={[]} />
      </div>
      <div data-case="untagged">
        <p className="text-xs text-charcoal-muted">Untagged legacy Meetup — section absent below:</p>
        <MeetupInterestTags primaryInterestId={null} additionalInterestIds={[]} />
      </div>
      <div data-case="malformed">
        <p className="text-xs text-charcoal-muted">Duplicates + unknown ids:</p>
        <MeetupInterestTags
          primaryInterestId="coffee"
          additionalInterestIds={["coffee", "nope_unknown", "vegan_food", "vegan_food"]}
        />
      </div>
    </div>
  );
}
