import { Link } from "react-router-dom";
import { PolicyLayout, PolicySection } from "./PolicyLayout";

/**
 * WO-099 §8 — member-readable Community Guidelines.
 *
 * This is product/community guidance, not legal boilerplate, so it is real,
 * final content rather than a placeholder. It restates the safety principles
 * already present in onboarding and Safety & Trust, and it reflects only
 * capabilities that actually exist (report, block, cancel, check in). No new
 * enforcement logic is introduced.
 */
export default function CommunityGuidelines() {
  return (
    <PolicyLayout
      title="Community Guidelines"
      intro="VeggieMeet works because everyone shows up with care. These are the things we ask of every Veggie."
    >
      <PolicySection heading="Be kind, and be real">
        <ul>
          <li>Treat every Veggie the way you'd like to be met — with warmth and respect.</li>
          <li>Be yourself. Don't impersonate another person, a business or a venue.</li>
          <li>
            Harassment, hate, and discriminatory abuse of any kind have no place
            here.
          </li>
          <li>No spam, no promotional blasting, no recruiting people into other schemes.</li>
        </ul>
      </PolicySection>

      <PolicySection heading="Respect boundaries">
        <ul>
          <li>
            A connection is an invitation, not an obligation. If someone doesn't
            reply, let it be.
          </li>
          <li>Keep conversations welcome. Don't push for personal details.</li>
          <li>
            You can block anyone at any time, and you never have to explain why.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="How connections work">
        <p>
          You send a <strong>Connection Request</strong>. If it's accepted, you're{" "}
          <strong>Connected</strong>. When you later meet in person, you can scan
          each other's QR code to become a <strong>Verified Connection</strong> —
          a simple record that you really met.
        </p>
        <p>
          Scanning a QR code never creates a relationship on its own. It only
          confirms a connection that already exists.
        </p>
      </PolicySection>

      <PolicySection heading="Meetups should be real">
        <ul>
          <li>
            Only create a Meetup you actually intend to show up for, at a real
            time and a real place.
          </li>
          <li>
            If your plans change, cancel early so your guests can plan around
            it.
          </li>
          <li>
            Hosts are community members like you. Choosing a Community Place
            does not mean VeggieMeet reserved it — call ahead for larger groups.
          </li>
          <li>Don't use Meetups to sell, promote or gather leads.</li>
        </ul>
      </PolicySection>

      <PolicySection heading="Keep Community Place information truthful">
        <ul>
          <li>
            Suggest places you've genuinely been to, and describe them
            accurately.
          </li>
          <li>Check in only when you're actually there.</li>
          <li>
            If something about a place is wrong — closed, moved, no longer fully
            plant-based — report the issue so we can re-check it.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="Meeting safely">
        <ul>
          <li>Meet in public places you know.</li>
          <li>Tell a friend where you're going, and arrange your own transport.</li>
          <li>Keep personal info private until you feel comfortable.</li>
          <li>Leave whenever something feels off — trust your judgment.</li>
        </ul>
      </PolicySection>

      <PolicySection heading="Use the tools when you need them">
        <p>
          Reporting and blocking are there for you, and both are private. The
          person you report or block is not told.
        </p>
        <ul>
          <li>
            Report a member, a Meetup, or a safety concern from{" "}
            <Link to="/safety" className="underline font-medium text-primary">
              Safety &amp; Trust
            </Link>{" "}
            or from the safety menu on their profile or Meetup.
          </li>
          <li>Report an issue with a Community Place from that place's page.</li>
          <li>
            If you are in immediate danger, contact local emergency services —
            VeggieMeet is not a substitute for emergency help.
          </li>
        </ul>
        <p className="text-charcoal-muted">
          Product problems and ideas belong in beta feedback, not in a safety
          report — so real safety issues reach us fast.
        </p>
      </PolicySection>

      <PolicySection heading="If guidelines are broken">
        <p>
          We review every report. Depending on what happened, that can mean a
          conversation, removing content, or removing access to VeggieMeet. For
          everyone's privacy, we may not share the details of a moderation
          outcome.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
