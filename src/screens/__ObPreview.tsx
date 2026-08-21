// TEMPORARY dev-only harness used to capture onboarding profile-setup screenshots.
// Deleted after capture.
import { useSearchParams } from "react-router-dom";
import {
  Identity,
  Dietary,
  HomeCity,
  SelectedCity,
  Interests,
  Photo,
  Guidelines,
  Safety,
  ProgressBar,
} from "./__ObPreviewSteps";
import { ONBOARDING_PROGRESS_STEPS } from "@/lib/onboarding";
import { useState } from "react";
import { BackButton } from "@/components/app";

const noop = () => {};

export default function ObPreview() {
  const [params] = useSearchParams();
  const step = params.get("step") ?? "identity";
  const [displayName, setDisplayName] = useState("Mai");
  const [pronouns, setPronouns] = useState("she/her");
  const [dietary, setDietary] = useState<any>("vegan");
  const [interests, setInterests] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const idx = ONBOARDING_PROGRESS_STEPS.indexOf(step as any);

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <header className="safe-top sticky top-0 z-30 bg-background/85 backdrop-blur-md">
        <div className="flex items-center justify-between px-5 pt-3 pb-2 min-h-[3.5rem]">
          <BackButton onClick={noop} />
          <span className="text-xs font-medium text-charcoal-muted tabular-nums">
            Step {idx + 1} of {ONBOARDING_PROGRESS_STEPS.length}
          </span>
          <div className="w-9" />
        </div>
        {idx >= 0 && (
          <div className="px-5 pb-3">
            <ProgressBar total={ONBOARDING_PROGRESS_STEPS.length} current={idx + 1} />
          </div>
        )}
      </header>
      <div className="flex-1 flex flex-col">
        {step === "identity" && (
          <Identity
            displayName={displayName}
            setDisplayName={setDisplayName}
            pronouns={pronouns}
            setPronouns={setPronouns}
            onContinue={noop}
          />
        )}
        {step === "dietary" && <Dietary value={dietary} setValue={setDietary} onContinue={noop} />}
        {step === "home_city" && (
          <HomeCity cityId={null} cityName={null} onSelect={noop} onContinue={noop} />
        )}
        {step === "selected_city" && (
          <SelectedCity
            cityId={null}
            cityName={null}
            homeCityId={null}
            homeCityName={"Ho Chi Minh City"}
            onSelect={noop}
            onContinue={noop}
          />
        )}
        {step === "interests" && (
          <Interests
            selected={interests}
            toggle={(l: string) =>
              setInterests((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))
            }
            onContinue={noop}
          />
        )}
        {step === "photo" && (
          <Photo
            avatarUrl={avatarUrl}
            setAvatarUrl={setAvatarUrl}
            displayName={displayName}
            bio={bio}
            setBio={setBio}
            onContinue={noop}
            onSkip={noop}
          />
        )}
        {step === "guidelines" && (
          <Guidelines accepted={accepted} setAccepted={setAccepted} onContinue={noop} />
        )}
        {step === "safety" && <Safety onContinue={noop} />}
      </div>
    </div>
  );
}
