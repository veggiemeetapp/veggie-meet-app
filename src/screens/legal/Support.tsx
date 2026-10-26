import { Link } from "react-router-dom";
import { PolicyLayout, PolicySection } from "./PolicyLayout";
import { OPERATOR_NAME, SUPPORT_EMAIL } from "@/lib/supportContact";

/**
 * Public support page. App Store Connect requires a working Support URL, and
 * reviewers open it, so this route stays outside the auth gate and works
 * without a session.
 */
export default function Support() {
  return (
    <PolicyLayout
      title="Support"
      intro="Questions, problems or feedback about VeggieMeet? We are happy to help."
    >
      <PolicySection heading="Contact us">
        <p>
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline font-medium text-primary">
            {SUPPORT_EMAIL}
          </a>{" "}
          and we will get back to you as soon as we can. Please include the
          email address you use to sign in and, if relevant, the name of the
          Meetup or Community Place.
        </p>
      </PolicySection>

      <PolicySection heading="Your account">
        <ul>
          <li>
            Forgot your password? Choose <strong>Forgot password</strong> on the
            sign-in screen to receive a reset link.
          </li>
          <li>
            To delete your account and its data, open{" "}
            <strong>Settings → Account → Delete account</strong> in the app. You
            can also email us and we will delete it for you.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="Safety">
        <p>
          To report a member, a Meetup or a Community Place, use the report
          and block tools in the app, described in{" "}
          <Link to="/safety" className="underline font-medium text-primary">
            Safety &amp; Trust
          </Link>
          . If you are in immediate danger, contact local emergency services.
        </p>
      </PolicySection>

      <PolicySection heading="Policies">
        <ul>
          <li>
            <Link to="/privacy" className="underline font-medium text-primary">
              Privacy
            </Link>
          </li>
          <li>
            <Link to="/terms" className="underline font-medium text-primary">
              Terms
            </Link>
          </li>
          <li>
            <Link to="/community-guidelines" className="underline font-medium text-primary">
              Community Guidelines
            </Link>
          </li>
        </ul>
        <p>VeggieMeet is operated by {OPERATOR_NAME}.</p>
      </PolicySection>
    </PolicyLayout>
  );
}
