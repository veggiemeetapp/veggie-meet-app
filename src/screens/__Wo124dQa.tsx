// TEMPORARY WO-124D QA harness. Removed after evidence capture.
import { useEffect, useState } from "react";
import { InterestPicker } from "@/components/interests/InterestPicker";
import { MeetupInterestPicker } from "@/components/interests/MeetupInterestPicker";
import { fetchInterestCatalogue, type InterestOption } from "@/lib/onboarding";
import {
  ONBOARDING_MAX_INTERESTS,
  ONBOARDING_MIN_INTERESTS,
  PROFILE_MAX_INTERESTS,
  PROFILE_MIN_INTERESTS,
} from "@/lib/interests";

export default function Wo124dQa() {
  const [options, setOptions] = useState<InterestOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState<string[]>([]);
  const [profile, setProfile] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [additional, setAdditional] = useState<string[]>([]);

  useEffect(() => {
    fetchInterestCatalogue()
      .then(setOptions)
      .finally(() => setLoading(false));
  }, []);

  function toggle(list: string[], set: (v: string[]) => void, max: number) {
    return (label: string) => {
      if (list.includes(label)) set(list.filter((x) => x !== label));
      else if (list.length < max) set([...list, label]);
    };
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 space-y-10">
      <section data-testid="qa-onboarding">
        <h1 className="text-xl font-semibold text-charcoal mb-1">
          Onboarding picker ({onboarding.length}/{ONBOARDING_MAX_INTERESTS})
        </h1>
        <p className="text-xs text-charcoal-muted mb-3">
          catalogue rows: <span data-testid="qa-count">{options.length}</span>
        </p>
        <InterestPicker
          options={options}
          selected={onboarding}
          onToggle={toggle(onboarding, setOnboarding, ONBOARDING_MAX_INTERESTS)}
          min={ONBOARDING_MIN_INTERESTS}
          max={ONBOARDING_MAX_INTERESTS}
          loading={loading}
        />
        <button
          type="button"
          disabled={onboarding.length < ONBOARDING_MIN_INTERESTS}
          className="mt-4 w-full min-h-11 rounded-control bg-primary text-primary-foreground font-semibold disabled:opacity-40"
        >
          Continue
        </button>
      </section>

      <section data-testid="qa-profile">
        <h2 className="text-xl font-semibold text-charcoal mb-3">
          Profile editor ({profile.length}/{PROFILE_MAX_INTERESTS})
        </h2>
        <InterestPicker
          options={options}
          selected={profile}
          onToggle={toggle(profile, setProfile, PROFILE_MAX_INTERESTS)}
          min={PROFILE_MIN_INTERESTS}
          max={PROFILE_MAX_INTERESTS}
          loading={loading}
        />
      </section>

      <section data-testid="qa-meetup">
        <h2 className="text-xl font-semibold text-charcoal mb-3">
          What is this Meetup about?
        </h2>
        <MeetupInterestPicker
          options={options}
          loading={loading}
          primaryId={primary}
          additionalIds={additional}
          onPrimaryChange={setPrimary}
          onAdditionalChange={setAdditional}
        />
      </section>
    </main>
  );
}
