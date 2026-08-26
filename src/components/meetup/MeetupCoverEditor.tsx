import { useId, useRef, useState } from "react";
import { Camera, ImageOff, Loader2 } from "lucide-react";
import { SecondaryButton, TertiaryButton } from "@/components/app";
import {
  MEETUP_COVER_ALLOWED_MIME,
  processMeetupCoverFile,
  type CoverDraft,
} from "@/lib/meetupCover";

interface Props {
  /** The cover currently persisted for this Meetup, or null when it has none. */
  currentCover: string | null;
  draft: CoverDraft;
  onDraftChange: (draft: CoverDraft) => void;
  disabled?: boolean;
  /** Cover-specific save error, rendered inside the section. */
  saveError?: string | null;
}

/**
 * WO-133 — Meetup cover editor for Manage Meetup.
 *
 * Edits are staged: nothing is written until the host saves the Manage Meetup
 * form, which is why Remove needs no confirmation modal — it is reversible with
 * "Undo removal" until Save. The processing pipeline and the allowlist are the
 * shared WO-131/WO-131B ones; there is no edit-only security rule.
 */
export function MeetupCoverEditor({
  currentCover,
  draft,
  onDraftChange,
  disabled,
  saveError,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const preview =
    draft.kind === "removed" ? null : draft.kind === "replaced" ? draft.dataUrl : currentCover;
  const message = error ?? saveError ?? null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires a change.
    e.target.value = "";
    if (!file || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await processMeetupCoverFile(file);
      if (result.status === "ok") {
        // A successful pick always wins over a pending removal.
        onDraftChange({ kind: "replaced", dataUrl: result.dataUrl });
      } else {
        // A failed pick never touches the staged/published cover.
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${errorId}-heading`} data-manage-field="cover">
      <h2
        id={`${errorId}-heading`}
        className="block text-sm font-semibold text-charcoal mb-2"
      >
        Meetup cover
      </h2>

      {preview ? (
        <div className="rounded-card overflow-hidden border border-border bg-muted">
          <img
            src={preview}
            alt="Current Meetup cover"
            className="w-full h-44 object-cover"
          />
        </div>
      ) : (
        <div className="rounded-card border-2 border-dashed border-border bg-muted/40 h-44 flex flex-col items-center justify-center gap-2 text-charcoal-muted">
          <ImageOff className="w-6 h-6" aria-hidden="true" />
          <p className="text-sm font-medium">No cover photo</p>
          <p className="text-xs">Veggies will see the default VeggieMeet image.</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <SecondaryButton
          size="sm"
          disabled={disabled || busy}
          aria-label={preview ? "Change Meetup cover photo" : "Add Meetup cover photo"}
          aria-describedby={message ? errorId : undefined}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Camera className="w-4 h-4" aria-hidden="true" />
          )}
          {busy ? "Preparing photo…" : preview ? "Change photo" : "Add photo"}
        </SecondaryButton>

        {draft.kind === "removed" ? (
          <TertiaryButton
            size="sm"
            disabled={disabled || busy}
            aria-label="Undo removing the Meetup cover photo"
            onClick={() => onDraftChange({ kind: "unchanged" })}
          >
            Undo removal
          </TertiaryButton>
        ) : preview ? (
          <TertiaryButton
            size="sm"
            disabled={disabled || busy}
            aria-label="Remove Meetup cover photo"
            onClick={() => {
              setError(null);
              onDraftChange({ kind: "removed" });
            }}
          >
            Remove photo
          </TertiaryButton>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-charcoal-muted">
        JPG, PNG, or WebP. Cover changes are saved with the rest of your Meetup details.
      </p>

      {message ? (
        <p id={errorId} role="alert" className="mt-2 text-xs font-medium text-destructive">
          {message}
        </p>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={MEETUP_COVER_ALLOWED_MIME.join(",")}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFile}
      />
    </section>
  );
}
