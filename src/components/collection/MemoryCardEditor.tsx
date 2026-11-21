import { useEffect, useRef, useState } from "react";
import { Camera, Eye, EyeOff, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, PrimaryButton, SecondaryButton, TertiaryButton } from "@/components/app";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MemoryCardFrame } from "@/components/collection/MemoryCardTile";
import {
  useDeleteMemoryCard,
  useMyMemoryCard,
  useSaveMemoryCard,
  useUpdateMemoryCard,
} from "@/hooks/useCollection";
import { MEMORY_CARD_CAPTION_MAX, normalizeCaption, processMemoryCardPhoto } from "@/lib/memoryCard";
import { memberSafeMessage } from "@/lib/errors";

/**
 * "Memory card" section on the Meetup Summary screen. Lets a member who
 * attended or hosted an ended meetup attach one photo, a short caption, hide
 * it from their public collection, or remove it. Renders nothing while the
 * member is not eligible, so the summary screen is unchanged for everyone
 * else.
 */
export function MemoryCardEditor({
  meetupId,
  title,
  date,
  placeLabel,
}: {
  meetupId: string;
  title: string;
  date: string;
  placeLabel: string | null;
}) {
  const cardQ = useMyMemoryCard(meetupId);
  const save = useSaveMemoryCard();
  const update = useUpdateMemoryCard();
  const remove = useDeleteMemoryCard();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<{ photo: string; thumb: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [processing, setProcessing] = useState(false);

  const card = cardQ.data;
  useEffect(() => {
    if (card?.found) setCaption(card.caption ?? "");
  }, [card?.found, card?.caption]);

  if (cardQ.isPending || !card) return null;
  if (!card.found && !card.eligible) return null;

  const busy = processing || save.isPending || update.isPending || remove.isPending;

  const pick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      const res = await processMemoryCardPhoto(file);
      if (res.status === "error") {
        toast.error(res.message);
        return;
      }
      setPending({ photo: res.photoDataUrl, thumb: res.thumbDataUrl });
    } finally {
      setProcessing(false);
    }
  };

  const submit = () => {
    if (!pending) return;
    save.mutate(
      { meetupId, photoDataUrl: pending.photo, thumbDataUrl: pending.thumb, caption: normalizeCaption(caption) },
      {
        onSuccess: () => {
          setPending(null);
          toast.success(card.found ? "Memory card updated." : "Memory card added to your collection.");
        },
        onError: (err) => toast.error(memberSafeMessage(err)),
      },
    );
  };

  const saveCaption = () => {
    const next = normalizeCaption(caption);
    if (next === (card.caption ?? "")) return;
    update.mutate(
      { meetupId, caption: next },
      {
        onSuccess: () => toast.success("Caption saved."),
        onError: (err) => toast.error(memberSafeMessage(err)),
      },
    );
  };

  const toggleVisibility = () => {
    update.mutate(
      { meetupId, isPublic: !card.is_public },
      {
        onSuccess: () => toast.success(card.is_public ? "Hidden from your public collection." : "Visible on your collection."),
        onError: (err) => toast.error(memberSafeMessage(err)),
      },
    );
  };

  const confirmRemove = () => {
    if (!window.confirm("Remove this memory card? The photo will be deleted.")) return;
    remove.mutate(meetupId, {
      onSuccess: () => {
        setPending(null);
        setCaption("");
        toast.success("Memory card removed.");
      },
      onError: (err) => toast.error(memberSafeMessage(err)),
    });
  };

  const previewSrc = pending?.photo ?? (card.found ? card.photo_data_url : null) ?? null;

  return (
    <Card padding="lg" className="space-y-3" data-testid="memory-card-editor">
      <div className="flex items-center gap-2">
        <Camera className="w-4 h-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-charcoal">Memory card</h3>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="hidden"
        onChange={onFile}
      />

      {previewSrc ? (
        <>
          <div className="max-w-[240px] mx-auto">
            <MemoryCardFrame
              src={previewSrc}
              title={title}
              date={date}
              placeLabel={placeLabel}
              caption={pending ? undefined : card.caption}
              hidden={card.found && !card.is_public}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memory-caption">Caption (optional)</Label>
            <Input
              id="memory-caption"
              value={caption}
              maxLength={MEMORY_CARD_CAPTION_MAX}
              placeholder="e.g. Best bánh mì chay in town"
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => !pending && card.found && saveCaption()}
            />
            <p className="text-[11px] text-charcoal-muted text-right">
              {caption.length}/{MEMORY_CARD_CAPTION_MAX}
            </p>
          </div>
          {pending ? (
            <div className="flex gap-2">
              <PrimaryButton size="sm" onClick={submit} disabled={busy} className="flex-1">
                {save.isPending ? "Saving…" : card.found ? "Replace photo" : "Save to collection"}
              </PrimaryButton>
              <SecondaryButton size="sm" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </SecondaryButton>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <TertiaryButton size="sm" onClick={pick} disabled={busy}>
                <ImagePlus className="w-4 h-4" /> Change photo
              </TertiaryButton>
              <TertiaryButton size="sm" onClick={toggleVisibility} disabled={busy}>
                {card.is_public ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {card.is_public ? "Hide" : "Show"}
              </TertiaryButton>
              <TertiaryButton size="sm" onClick={confirmRemove} disabled={busy}>
                <Trash2 className="w-4 h-4" /> Remove
              </TertiaryButton>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-charcoal-muted">
            Took a photo with the group? Turn it into a card for your collection. Only you choose what to add.
          </p>
          <PrimaryButton size="sm" onClick={pick} disabled={busy}>
            <ImagePlus className="w-4 h-4" />
            {processing ? "Preparing photo…" : "Add a photo"}
          </PrimaryButton>
        </>
      )}
    </Card>
  );
}

export default MemoryCardEditor;
