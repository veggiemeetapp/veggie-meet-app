import { memberSafeMessage } from "@/lib/errors";
import { safeBack } from "@/lib/navigation";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { updateMyProfile } from "@/lib/profile";
import { uploadAvatar } from "@/lib/imageUpload";
import {
  MAX_INTERESTS,
  MIN_INTERESTS,
  fetchInterestCatalogue,
} from "@/lib/onboarding";

function sampleAvatar() {
  const seed = `veggie-${Math.random().toString(36).slice(2, 8)}`;
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=c8e6c9`;
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
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const location = useLocationContext();
  const setHomeCity = useSetHomeCity();
  const homeCity = location.data?.home_city ?? null;

  // Interests come from the approved server catalogue — the same taxonomy the
  // `update_my_profile` RPC validates against, so the UI can never offer a
  // value the server will reject.
  const catalogue = useQuery({
    queryKey: ["interest-catalogue"],
    queryFn: fetchInterestCatalogue,
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setBio(profile.bio ?? "");
    setAvatarUrl(profile.avatar_url ?? null);
    setInterests(profile.interests ?? []);
  }, [profile]);

  const nameValid = displayName.trim().length > 0 && displayName.trim().length <= 40;
  const cityValid = !!homeCity?.id;
  const interestsValid =
    interests.length >= MIN_INTERESTS && interests.length <= MAX_INTERESTS;
  const canSave = nameValid && cityValid && interestsValid && dirty && !saving && !uploading;

  function toggleInterest(label: string) {
    setInterests((s) =>
      s.includes(label)
        ? s.filter((x) => x !== label)
        : s.length >= MAX_INTERESTS
          ? s
          : [...s, label],
    );
    setDirty(true);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Avatars live in the private `avatars` bucket under `<auth.uid()>/…`, so
      // storage RLS enforces ownership. The profile row only ever stores the
      // resulting hosted URL — never inline image data.
      const url = await uploadAvatar(file);
      setAvatarUrl(url);
      setDirty(true);
      setAvatarSheet(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? memberSafeMessage(err)
          : "We couldn't upload that image. Try another one.",
      );
    } finally {
      setUploading(false);
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
    setSaveError(null);
    // Home City is persisted via set_home_city RPC; the profile mutation only
    // writes the fields owned by this form. All validation is re-applied
    // server-side inside update_my_profile.
    try {
      await updateMyProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl,
        clearAvatar: !avatarUrl,
        interests,
      });
      await refreshProfile();
      toast.success("Profile updated");
      navigate("/you", { replace: true });
    } catch (err) {
      const msg =
        memberSafeMessage(err);
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
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
            onClick={() => safeBack(navigate, "/you")}
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
              aria-label="Display name"
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
              aria-label="Short bio"
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
            label={`Interests (${interests.length}/${MAX_INTERESTS})`}
            required
            error={
              !interestsValid && dirty
                ? `Pick between ${MIN_INTERESTS} and ${MAX_INTERESTS} interests.`
                : undefined
            }
          >
            {catalogue.isLoading ? (
              <p className="text-sm text-charcoal-muted">Loading interests…</p>
            ) : (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Interests"
              >
                {(catalogue.data ?? []).map((i) => {
                  const active = interests.includes(i.label);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleInterest(i.label)}
                      className={cn(
                        "min-h-11 px-3.5 py-2 rounded-full text-sm font-medium border transition",
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-charcoal border-border hover:bg-accent/60",
                      )}
                    >
                      {active && <span className="mr-1.5" aria-hidden="true">✓</span>}
                      {i.label}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {saveError && (
            <p role="alert" aria-live="polite" className="text-sm text-destructive">
              {saveError}
            </p>
          )}

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
        aria-label="Upload profile photo"
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
