import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, ImagePlus, Shuffle, Trash2 } from "lucide-react";
import { PrimaryButton, UserAvatar } from "@/components/app";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useLocationContext, useSetHomeCity } from "@/hooks/useLocation";
import { CitySelector } from "@/components/location/CitySelector";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const INTERESTS = [
  { emoji: "☕", label: "Coffee" },
  { emoji: "🥗", label: "Vegan Food" },
  { emoji: "🥾", label: "Hiking" },
  { emoji: "📚", label: "Books" },
  { emoji: "🎲", label: "Board Games" },
  { emoji: "🎨", label: "Art" },
  { emoji: "🏃", label: "Running" },
  { emoji: "🎵", label: "Live Music" },
  { emoji: "🌱", label: "Gardening" },
  { emoji: "🧘", label: "Yoga" },
  { emoji: "🎬", label: "Movies" },
  { emoji: "🌍", label: "Travel" },
];


function sampleAvatar() {
  const seed = `veggie-${Math.random().toString(36).slice(2, 8)}`;
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=c8e6c9`;
}

/** Compress an uploaded photo into a persistent JPEG data URL. */
async function fileToCompressedDataUrl(file: File, max = 512): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export default function EditProfile() {
  const navigate = useNavigate();
  const { profile, loading, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const location = useLocationContext();
  const setHomeCity = useSetHomeCity();
  const homeCity = location.data?.home_city ?? null;

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url ?? null);
    setInterests(profile.interests ?? []);
  }, [profile]);

  const nameValid = displayName.trim().length > 0;
  const cityValid = !!homeCity?.id;
  const interestsValid = interests.length >= 1;
  const canSave = nameValid && cityValid && interestsValid && dirty && !saving;

  function toggleInterest(label: string) {
    setInterests((s) =>
      s.includes(label) ? s.filter((x) => x !== label) : [...s, label],
    );
    setDirty(true);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await fileToCompressedDataUrl(file);
      setAvatarUrl(url);
      setDirty(true);
      setAvatarSheet(false);
    } catch {
      toast.error("We couldn't read that image. Try another one.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleHomeCityChange(cityId: string) {
    try {
      await setHomeCity.mutateAsync(cityId);
      setDirty(true);
      toast.success("Home City updated");
    } catch {
      toast.error("We couldn't update your Home City. Try again.");
    }
  }

  async function handleSave() {
    if (!profile || !canSave) return;
    setSaving(true);
    // Home City is persisted via set_home_city RPC; profile mutation only writes
    // the fields owned by this form so we never revert the canonical city model.
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl,
        interests,
      })
      .eq("id", profile.id);
    setSaving(false);
    if (error) {
      toast.error("We couldn't save your profile. Please try again.");
      return;
    }
    await refreshProfile();
    toast.success("Profile updated");
    navigate("/you", { replace: true });
  }

  if (loading || !profile) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-charcoal-muted">
        Loading your profile…
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <header className="safe-top sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border/60">
        <div className="flex items-center justify-between px-5 pt-3 pb-3 min-h-[3.5rem]">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-charcoal">Edit Profile</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="flex-1 px-6 pt-4 pb-28">
        {/* Avatar */}
        <div className="flex flex-col items-center mb-6">
          <button
            type="button"
            onClick={() => setAvatarSheet(true)}
            aria-label="Change profile photo"
            className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] transition"
          >
            <UserAvatar
              name={displayName || "You"}
              src={avatarUrl ?? undefined}
              size="xl"
            />
            <span className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-green">
              <Camera className="w-4 h-4" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setAvatarSheet(true)}
            className="mt-3 text-xs font-semibold text-primary hover:underline"
          >
            Change photo
          </button>
        </div>

        <div className="space-y-5">
          <Field
            label="Display name"
            required
            error={!nameValid && dirty ? "Display name is required." : undefined}
          >
            <input
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setDirty(true);
              }}
              maxLength={40}
              placeholder="How should Veggies call you?"
              className="w-full h-12 rounded-xl border border-border bg-card px-4 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <Field label="Short bio">
            <textarea
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setDirty(true);
              }}
              rows={4}
              maxLength={160}
              placeholder="Tell Veggies a little about yourself."
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-base text-charcoal placeholder:text-charcoal-muted focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <p className="mt-1.5 text-xs text-charcoal-muted text-right">
              {bio.length}/160
            </p>
          </Field>

          <Field
            label="Home City"
            required
            error={!cityValid && dirty ? "Please pick your Home City." : undefined}
          >
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <div className="text-base font-medium text-charcoal truncate">
                  {homeCity?.name ?? "Not set"}
                </div>
                <p className="mt-0.5 text-xs text-charcoal-muted">
                  Where you live. Different from the city you're currently exploring.
                </p>
              </div>
              <CitySelector
                value={homeCity?.id ?? null}
                onSelect={handleHomeCityChange}
                triggerLabel="Change"
                title="Set your Home City"
              />
            </div>
          </Field>


          <Field
            label="Interests"
            required
            error={
              !interestsValid && dirty ? "Pick at least one interest." : undefined
            }
          >
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => {
                const active = interests.includes(i.label);
                return (
                  <button
                    key={i.label}
                    type="button"
                    onClick={() => toggleInterest(i.label)}
                    className={cn(
                      "px-3.5 py-2 rounded-full text-sm font-medium border transition",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-charcoal border-border hover:bg-accent/60",
                    )}
                  >
                    <span className="mr-1.5">{i.emoji}</span>
                    {i.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </main>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 mx-auto max-w-phone bg-card/95 backdrop-blur-xl border-t border-border px-5 py-3 safe-bottom">
        <PrimaryButton fullWidth onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save Changes"}
        </PrimaryButton>
      </div>

      {/* Avatar sheet */}
      <Sheet open={avatarSheet} onOpenChange={setAvatarSheet}>
        <SheetContent side="bottom" className="rounded-t-3xl border-t border-border p-0">
          <SheetHeader className="px-6 pt-6 pb-2 text-left">
            <SheetTitle className="text-lg font-semibold text-charcoal">
              Profile photo
            </SheetTitle>
            <SheetDescription className="text-sm text-charcoal-muted">
              You can always change this later.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6 pt-3 space-y-1">
            <SheetRow
              icon={<Shuffle className="w-5 h-5" />}
              label="Choose sample avatar"
              onClick={() => {
                setAvatarUrl(sampleAvatar());
                setDirty(true);
                setAvatarSheet(false);
              }}
            />
            <SheetRow
              icon={<ImagePlus className="w-5 h-5" />}
              label="Upload photo"
              onClick={() => fileRef.current?.click()}
            />
            {avatarUrl && (
              <SheetRow
                icon={<Trash2 className="w-5 h-5" />}
                label="Remove photo"
                destructive
                onClick={() => {
                  setAvatarUrl(null);
                  setDirty(true);
                  setAvatarSheet(false);
                }}
              />
            )}
            <button
              type="button"
              onClick={() => setAvatarSheet(false)}
              className="w-full mt-2 h-12 rounded-2xl bg-muted text-charcoal font-semibold hover:bg-muted/80 transition"
            >
              Cancel
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-charcoal mb-2">
        {label}
        {required && <span className="text-primary"> *</span>}
      </label>
      {children}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SheetRow({
  icon,
  label,
  hint,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 p-3.5 rounded-2xl hover:bg-accent/40 active:scale-[0.99] transition text-left",
        destructive ? "text-destructive" : "text-charcoal",
      )}
    >
      <span
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
          destructive ? "bg-destructive/10" : "bg-muted",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 font-semibold">{label}</span>
      {hint && <span className="text-xs text-charcoal-muted">{hint}</span>}
    </button>
  );
}
