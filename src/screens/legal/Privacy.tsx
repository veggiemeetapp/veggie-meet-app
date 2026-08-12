import { Link } from "react-router-dom";
import { DraftNotice, PolicyLayout, PolicySection } from "./PolicyLayout";

/**
 * WO-099 §6 — public Privacy surface.
 *
 * IMPORTANT: VeggieMeet does not yet have owner-approved, legally reviewed
 * Privacy Policy text, and inventing one would be misleading. This page
 * therefore presents (a) an explicit draft notice and (b) a factual,
 * verifiable description of what the product actually does today. Every claim
 * below is checked against real app behaviour — nothing aspirational, no
 * invented retention periods, no invented legal entity or contact address.
 */
export default function Privacy() {
  return (
    <PolicyLayout
      title="Privacy"
      intro="How VeggieMeet handles your information today, in plain language."
    >
      <DraftNotice>
        <strong>This is not our final Privacy Policy.</strong> VeggieMeet is in
        private beta and the formal, reviewed Privacy Policy — including the
        operating entity, jurisdiction and a privacy contact address — is still
        being prepared. What follows is a factual description of how the product
        behaves today so you can make an informed choice. It is not a legal
        agreement.
      </DraftNotice>

      <PolicySection heading="What you give us">
        <ul>
          <li>Your email address, used to sign in and to send account emails.</li>
          <li>
            Your display name, and optionally pronouns, a short bio, a dietary
            identity, interests and a profile photo.
          </li>
          <li>Your selected city, used to show you nearby Meetups and Community Places.</li>
        </ul>
      </PolicySection>

      <PolicySection heading="What you create in the app">
        <ul>
          <li>Meetups you host, and Meetups you join or leave.</li>
          <li>Connection requests, connections and Verified Connections.</li>
          <li>Meetup chat messages and direct messages.</li>
          <li>Check-ins at Meetups and at Community Places.</li>
          <li>Reports and blocks you submit, and beta feedback you send.</li>
        </ul>
      </PolicySection>

      <PolicySection heading="Location">
        <p>
          VeggieMeet does not track your location in the background. Your
          <strong> selected city</strong> is a choice you make in the app — it is a
          city, not a GPS trail.
        </p>
        <p>
          When you check in at a Community Place or a Meetup, your device
          location is used once, at that moment, only to confirm you are there.
          Your coordinates are not saved.
        </p>
      </PolicySection>

      <PolicySection heading="Who can see what">
        <ul>
          <li>
            Your profile is visible to other signed-in members, and you can hide
            yourself from Discovery in Settings → Privacy &amp; Safety.
          </li>
          <li>
            Messages are visible to the people in that conversation. We do not
            claim end-to-end encryption — messages are stored on our servers,
            and safety reports may be reviewed by our team.
          </li>
          <li>
            Your Community Impact history is private to you. Your connections
            are yours; there is no public activity feed.
          </li>
          <li>Reports and blocks are private. The other person is not told.</li>
        </ul>
      </PolicySection>

      <PolicySection heading="Analytics">
        <p>
          We record first-party, operational product events — which screens are
          reached and whether core actions succeed — so we can find broken
          journeys during beta. There is no advertising tracking, no
          advertising SDK and no third-party behavioural tracker in the app.
        </p>
      </PolicySection>

      <PolicySection heading="Browser storage">
        <p>
          VeggieMeet stores your sign-in session in your browser so you stay
          logged in, plus a few small preferences (whether you were already
          asked for location or notification permission, and your recent
          searches). There are no advertising or marketing cookies.
        </p>
      </PolicySection>

      <PolicySection heading="Services we rely on">
        <p>
          Running VeggieMeet involves our hosting and database provider, our
          authentication provider (including Google sign-in if you use it),
          Google Places data used to verify Community Places, and an email
          delivery provider for account emails. The final Privacy Policy will
          name these formally once reviewed.
        </p>
      </PolicySection>

      <PolicySection heading="Deleting your account">
        <p>
          You can delete your account yourself in Settings → Account. Your
          profile, photo, connections, messages, invitations and notifications
          are removed and your upcoming hosted Meetups are cancelled.
          Anonymised records of Meetups that already happened, and of safety
          reports, are kept for community integrity. We do not currently
          publish a retention period; the final policy will state one.
        </p>
      </PolicySection>

      <PolicySection heading="Data export">
        <p>
          A self-service data export is not available yet.
        </p>
      </PolicySection>

      <PolicySection heading="Questions">
        <p>
          A dedicated privacy contact address is not published yet. Until it is,
          beta members can use{" "}
          <Link to="/settings/feedback" className="underline font-medium text-primary">
            Send beta feedback
          </Link>{" "}
          for product questions, and{" "}
          <Link to="/safety" className="underline font-medium text-primary">
            Safety &amp; Trust
          </Link>{" "}
          to report anything unsafe.
        </p>
      </PolicySection>
    </PolicyLayout>
  );
}
