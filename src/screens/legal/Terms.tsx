import { Link } from "react-router-dom";
import { DraftNotice, PolicyLayout, PolicySection } from "./PolicyLayout";

/**
 * WO-099 §7 — public Terms surface.
 *
 * No owner-approved, legally reviewed Terms of Service text exists yet, and
 * fabricating one would be misleading. The route exists (so links never break)
 * and states plainly what is and is not in force today. The practical rules
 * that DO exist are the Community Guidelines, which are linked rather than
 * restated as pseudo-legal clauses.
 */
export default function Terms() {
  return (
    <PolicyLayout
      title="Terms"
      intro="What using VeggieMeet means during private beta."
    >
      <DraftNotice>
        <strong>Our formal Terms of Service are not published yet.</strong>{" "}
        VeggieMeet is in private beta. The reviewed Terms — including the
        operating entity, governing jurisdiction, minimum age and formal
        contact details — are still being prepared. Nothing on this page is a
        final or binding agreement.
      </DraftNotice>

      <PolicySection heading="What applies today">
        <p>
          The rules that govern how members treat each other are our{" "}
          <Link
            to="/community-guidelines"
            className="underline font-medium text-primary"
          >
            Community Guidelines
          </Link>
          . They are short, plain and enforced through our reporting and
          blocking tools.
        </p>
      </PolicySection>

      <PolicySection heading="What VeggieMeet is">
        <p>
          VeggieMeet helps veggie people find each other and meet in person.
          Meetups are created and hosted by community members, not by
          VeggieMeet. Choosing a Community Place for a Meetup does not mean
          VeggieMeet has reserved a table or arranged anything with the venue.
        </p>
      </PolicySection>

      <PolicySection heading="Community Places">
        <p>
          “Verified by VeggieMeet” means we checked that the place exists and
          that its listing details match what we found. “100% Vegan” means the
          menu we reviewed was fully plant-based. It is not a commercial
          partnership, an endorsement beyond that check, a reservation, or any
          kind of health or safety certification. Menus and opening hours
          change — please check before you go.
        </p>
      </PolicySection>

      <PolicySection heading="Meeting in person">
        <p>
          Use your own judgment when you meet people from the app. Public
          places, your own transport, and telling a friend where you are going
          are all good habits. If something feels off, you can leave, block, or
          report — see{" "}
          <Link to="/safety" className="underline font-medium text-primary">
            Safety &amp; Trust
          </Link>
          .
        </p>
      </PolicySection>

      <PolicySection heading="Your account">
        <p>
          Your account is yours; please keep your sign-in details to yourself
          and don't impersonate anyone. You can delete your account at any time
          in Settings → Account. Accounts that break the Community Guidelines
          may lose access.
        </p>
      </PolicySection>

      <PolicySection heading="Beta expectations">
        <p>
          Features may change, break, or disappear during private beta, and the
          community is still small in most cities. Please tell us when something
          is wrong — beta feedback is read by a real person.
        </p>
      </PolicySection>

      <PolicySection heading="Privacy">
        <p>
          How your information is handled is described on the{" "}
          <Link to="/privacy" className="underline font-medium text-primary">
            Privacy
          </Link>{" "}
          page.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
