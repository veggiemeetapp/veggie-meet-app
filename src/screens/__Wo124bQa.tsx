// TEMPORARY WO-124B QA harness — renders the real member interest picker with
// the live production catalogue. Removed before closeout.
import { useEffect, useState } from "react";
import { InterestPicker } from "@/components/interests/InterestPicker";
import { fetchInterestCatalogue } from "@/lib/onboarding";
import type { InterestOption } from "@/lib/onboarding";

export default function Wo124bQa() {
  const [options, setOptions] = useState<InterestOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    fetchInterestCatalogue().then(setOptions).catch(() => setOptions([]));
  }, []);
  return (
    <main className="p-4">
      <h1 className="mb-4 text-lg font-semibold">WO-124B interest taxonomy QA</h1>
      <p data-testid="count">{options.length}</p>
      <InterestPicker
        options={options}
        selected={selected}
        onToggle={(l) =>
          setSelected((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))
        }
        min={3}
        max={8}
      />
    </main>
  );
}
