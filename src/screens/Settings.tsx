import { memberSafeMessage } from "@/lib/errors";
import { BackButton } from "@/components/app";
import { safeBack } from "@/lib/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronRight,
  Compass,
  Loader2,
  LogOut,
  Mail,
  MessageSquareHeart,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/app/AppHeader";
import { Card } from "@/components/app/Card";
import { PrimaryButton, SecondaryButton } from "@/components/app/Buttons";
import { CitySelector } from "@/components/location/CitySelector";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useLocationContext,
  useSetHomeCity,
} from "@/hooks/useLocation";
import {
  AccountSettings,
  DIETARY_OPTIONS,
  NOTIFICATION_CATEGORIES,
  NotificationPrefs,
  PRONOUN_OPTIONS,
  fetchMySettings,
  requestAccountDeletion,
  updateDiscoverySettings,
  updateNotificationPreferences,
  updatePrivacySettings,
  updateProfileSettings,
} from "@/lib/settings";
import { logOnboardingEvent } from "@/lib/onboarding";

type Section = "hub" | "profile" | "discovery" | "notifications" | "privacy" | "account";

const SECTION_LABELS: Record<Section, string> = {
  hub: "Settings",
  profile: "Profile",
  discovery: "Discovery",
  notifications: "Notifications",
  privacy: "Privacy",
  account: "Account",
};

export default function Settings() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = (params.get("section") as Section) || "hub";
  const qc = useQueryClient();
  const { refreshProfile } = useAuth();

  const settingsQuery = useQuery({
    queryKey: ["my-settings"],
    queryFn: fetchMySettings,
  });

  useEffect(() => {
    logOnboardingEvent("settings_opened", { section });
  }, [section]);

  function go(s: Section) {
    if (s === "hub") setParams({});
    else setParams({ section: s });
  }

  const title = SECTION_LABELS[section];

  const handleBack = () => {
    if (section === "hub") safeBack(navigate, "/you");
    else go("hub");
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["my-settings"] });
    refreshProfile();
  };

  return (
    <>
      <AppHeader
        title={title}
        left={
          <BackButton onClick={() => { handleBack(); }} />
        }
      />
      <div className="px-5 mt-2 pb-16">
        {settingsQuery.isLoading && (
          <div className="flex items-center justify-center py-16 text-charcoal-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {settingsQuery.isError && (
          <Card className="text-sm text-destructive text-center">
            Couldn't load your settings.
          </Card>
        )}
        {settingsQuery.data && section === "hub" && (
          <Hub data={settingsQuery.data} go={go} />
        )}
        {settingsQuery.data && section === "profile" && (
          <ProfileSection data={settingsQuery.data} onSaved={invalidate} />
        )}
        {settingsQuery.data && section === "discovery" && (
          <DiscoverySection data={settingsQuery.data} onSaved={invalidate} />
        )}
        {settingsQuery.data && section === "notifications" && (
          <NotificationsSection data={settingsQuery.data} onSaved={invalidate} />
        )}
        {settingsQuery.data && section === "privacy" && (
          <PrivacySection data={settingsQuery.data} onSaved={invalidate} navigate={navigate} />
        )}
        {settingsQuery.data && section === "account" && (
          <AccountSection data={settingsQuery.data} onChanged={invalidate} />
        )}
      </div>
    </>
  );
}

/* ---------- Hub ---------- */

function Hub({ data, go }: { data: AccountSettings; go: (s: Section) => void }) {
  const rows: {
    key: Section;
    icon: JSX.Element;
    title: string;
    hint?: string;
  }[] = [
    {
      key: "profile",
      icon: <User className="w-5 h-5" />,
      title: "Profile",
      hint: data.profile.display_name,
    },
    {
      key: "discovery",
      icon: <Compass className="w-5 h-5" />,
      title: "Discovery",
      hint: "Cities & interests",
    },
    {
      key: "notifications",
      icon: <Bell className="w-5 h-5" />,
      title: "Notifications",
      hint: "Choose what pings you",
    },
    {
      key: "privacy",
      icon: <ShieldCheck className="w-5 h-5" />,
      title: "Privacy & Safety",
      hint: data.privacy.discovery_visible ? "Visible in Discovery" : "Hidden from Discovery",
    },
    {
      key: "account",
      icon: <Mail className="w-5 h-5" />,
      title: "Account",
      hint: data.account.email ?? undefined,
    },
  ];

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => go(r.key)}
          className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border hover:bg-accent/40 transition-colors text-left min-h-14"
        >
          <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
            {r.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-charcoal">{r.title}</div>
            {r.hint && (
              <div className="text-xs text-charcoal-muted truncate">{r.hint}</div>
            )}
          </div>
          <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
        </button>
      ))}
    </div>
  );
}

/* ---------- Profile ---------- */

function ProfileSection({ data, onSaved }: { data: AccountSettings; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(data.profile.display_name);
  const [bio, setBio] = useState(data.profile.bio ?? "");
  const [dietary, setDietary] = useState<string>(data.profile.dietary_identity ?? "");
  const [pronouns, setPronouns] = useState<string>(data.profile.pronouns ?? "");

  const initial = useMemo(
    () => ({
      displayName: data.profile.display_name,
      bio: data.profile.bio ?? "",
      dietary: data.profile.dietary_identity ?? "",
      pronouns: data.profile.pronouns ?? "",
    }),
    [data.profile],
  );

  const dirty =
    displayName !== initial.displayName ||
    bio !== initial.bio ||
    dietary !== initial.dietary ||
    pronouns !== initial.pronouns;

  const save = useMutation({
    mutationFn: () =>
      updateProfileSettings({
        display_name: displayName,
        bio,
        dietary_identity: dietary || null,
        pronouns: pronouns || null,
      }),
    onSuccess: () => {
      toast.success("Profile updated");
      logOnboardingEvent("settings_profile_updated", {});
      onSaved();
    },
    onError: (e: Error) =>
      toast.error("Couldn't save", { description: memberSafeMessage(e) }),
  });

  const nameValid = displayName.trim().length > 0 && displayName.trim().length <= 40;

  return (
    <div className="space-y-5">
      <Field label="Display name" htmlFor="settings-display-name">
        <Input
          id="settings-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          placeholder="How other Veggies see you"
        />
      </Field>

      <Field label="Bio" hint={`${bio.length}/500`} htmlFor="settings-bio">
        <Textarea
          id="settings-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 500))}
          rows={4}
          placeholder="A sentence or two about you."
        />
      </Field>

      <Field label="Dietary identity">
        <ChipGroup
          groupLabel="Dietary identity"
          options={DIETARY_OPTIONS}
          value={dietary}
          onChange={setDietary}
        />
      </Field>

      <Field label="Pronouns">
        <ChipGroup
          groupLabel="Pronouns"
          options={PRONOUN_OPTIONS}
          value={pronouns}
          onChange={setPronouns}
        />
      </Field>


      <PrimaryButton
        fullWidth
        disabled={!dirty || !nameValid || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save changes"}
      </PrimaryButton>
    </div>
  );
}

/* ---------- Discovery ---------- */

function DiscoverySection({ data, onSaved }: { data: AccountSettings; onSaved: () => void }) {
  const contextQuery = useLocationContext();
  const setHome = useSetHomeCity();

  const [interests, setInterests] = useState<string[]>(data.discovery.interests);
  const dirty =
    JSON.stringify(interests) !== JSON.stringify(data.discovery.interests);
  const valid = interests.length >= 3 && interests.length <= 8;

  const save = useMutation({
    mutationFn: () => updateDiscoverySettings({ interests }),
    onSuccess: () => {
      toast.success("Interests updated");
      logOnboardingEvent("discovery_settings_saved", { interests_count: interests.length });
      onSaved();
    },
    onError: (e: Error) =>
      toast.error("Couldn't save", { description: memberSafeMessage(e) }),
  });

  const home = contextQuery.data?.home_city;
  const selected = contextQuery.data?.selected_city;

  return (
    <div className="space-y-6">
      <Field
        label="Home City"
        hint="Your long-term location. Used to keep you grounded when travelling."
      >
        <CitySelector
          variant="block"
          value={home?.id ?? null}
          triggerLabel={home?.name ?? "Choose Home City"}
          title="Home City"
          onSelect={async (id, name) => {
            try {
              await setHome.mutateAsync(id);
              toast.success(`Home set to ${name}`);
              onSaved();
            } catch (e) {
              toast.error("Couldn't update Home City", {
                description: memberSafeMessage(e),
              });
            }
          }}
        />
      </Field>

      <Field
        label="Selected City"
        hint="What you're exploring right now. Shapes Today and Search."
      >
        <CitySelector
          variant="block"
          triggerLabel={selected?.name ?? "Choose Selected City"}
          title="Selected City"
        />
      </Field>

      <Field
        label="Interests"
        hint={`${interests.length}/8 · at least 3`}
      >
        <InterestPicker value={interests} onChange={setInterests} />
      </Field>

      <PrimaryButton
        fullWidth
        disabled={!dirty || !valid || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save interests"}
      </PrimaryButton>
    </div>
  );
}

function InterestPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const catalogue = useQuery({
    queryKey: ["interest-catalogue"],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from("interest_catalogue")
        .select("id,label")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as { id: string; label: string }[];
    },
  });

  const items = catalogue.data ?? [];
  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      if (value.length >= 8) {
        toast("You can pick up to 8 interests.");
        return;
      }
      onChange([...value, id]);
    }
  }

  if (catalogue.isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-charcoal-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading interests…
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => {
        const on = value.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => toggle(i.id)}
            aria-pressed={on}
            className={`px-3 h-11 rounded-full text-sm font-medium border transition-colors ${
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-charcoal border-border hover:bg-accent/40"
            }`}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Notifications ---------- */

function NotificationsSection({
  data,
  onSaved,
}: {
  data: AccountSettings;
  onSaved: () => void;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(data.notifications);
  const [pending, setPending] = useState<keyof NotificationPrefs | null>(null);

  useEffect(() => setPrefs(data.notifications), [data.notifications]);

  async function toggle(key: keyof NotificationPrefs) {
    const prev = prefs[key];
    const next = !prev;
    setPrefs({ ...prefs, [key]: next });
    setPending(key);
    try {
      const updated = await updateNotificationPreferences({ [key]: next } as Partial<NotificationPrefs>);
      setPrefs(updated);
      logOnboardingEvent("notification_preference_changed", { key, enabled: next });
      onSaved();
    } catch (e) {
      setPrefs({ ...prefs, [key]: prev });
      toast.error("Couldn't update", {
        description: memberSafeMessage(e),
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-1">
      {NOTIFICATION_CATEGORIES.map((cat) => (
        <div
          key={cat.key}
          className="flex items-start gap-3 p-4 rounded-2xl bg-card border border-border min-h-14"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-charcoal">{cat.title}</div>
            <div className="text-xs text-charcoal-muted mt-0.5">
              {cat.description}
            </div>
          </div>
          <Switch
            checked={prefs[cat.key]}
            onCheckedChange={() => toggle(cat.key)}
            disabled={pending === cat.key}
            aria-label={cat.title}
          />
        </div>
      ))}
      <p className="text-xs text-charcoal-muted px-1 pt-3">
        You'll always receive safety-critical messages (like an admin action on
        your account), regardless of these settings.
      </p>
    </div>
  );
}

/* ---------- Privacy ---------- */

function PrivacySection({
  data,
  onSaved,
  navigate,
}: {
  data: AccountSettings;
  onSaved: () => void;
  navigate: (to: string) => void;
}) {
  const [visible, setVisible] = useState(data.privacy.discovery_visible);
  const [pending, setPending] = useState(false);
  // WO-081: live browser permission state, kept strictly separate from the
  // VeggieMeet-side record below. Reading these never triggers a prompt and
  // never requests coordinates.
  const [browserNotificationLabel, setBrowserNotificationLabel] =
    useState("unsupported in this browser");
  const [browserLocationLabel, setBrowserLocationLabel] = useState("unknown");

  // Keep the switch honest if the value changes elsewhere (other tab/device).
  useEffect(() => setVisible(data.privacy.discovery_visible), [data.privacy.discovery_visible]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const p = window.Notification.permission;
      setBrowserNotificationLabel(
        p === "default" ? "not decided" : p === "granted" ? "allowed" : "blocked",
      );
    }
    let cancelled = false;
    if (typeof navigator !== "undefined" && !("geolocation" in navigator)) {
      setBrowserLocationLabel("unsupported in this browser");
    } else if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((s) => {
          if (cancelled) return;
          setBrowserLocationLabel(
            s.state === "prompt" ? "not decided" : s.state === "granted" ? "allowed" : "blocked",
          );
        })
        .catch(() => {
          if (!cancelled) setBrowserLocationLabel("unknown");
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);


  async function toggleVisibility() {
    const prev = visible;
    const next = !prev;
    setVisible(next);
    setPending(true);
    try {
      await updatePrivacySettings({ discovery_visible: next });
      logOnboardingEvent("profile_visibility_changed", { discovery_visible: next });
      onSaved();
    } catch (e) {
      setVisible(prev);
      toast.error("Couldn't update", {
        description: memberSafeMessage(e),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-card border border-border flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-charcoal">
            Show me in Discovery
          </div>
          <div className="text-xs text-charcoal-muted mt-0.5">
            When off, other Veggies won't find your profile through Search or
            "Veggies Nearby." Your existing connections still see you.
          </div>
        </div>
        <Switch
          checked={visible}
          onCheckedChange={toggleVisibility}
          disabled={pending}
          aria-label="Show me in Discovery"
        />
      </div>

      <button
        type="button"
        onClick={() => navigate("/safety")}
        className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border hover:bg-accent/40 text-left min-h-14"
      >
        <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-charcoal">
            Safety & Trust Center
          </div>
          <div className="text-xs text-charcoal-muted">
            Blocked profiles, reports, and safety guidance.
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
      </button>

      {/* WO-089: private beta feedback. Deliberately separate from Safety. */}
      <button
        type="button"
        onClick={() => navigate("/settings/feedback?surface=settings")}
        className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border hover:bg-accent/40 text-left min-h-14"
      >
        <div className="w-10 h-10 rounded-2xl bg-soft-green text-primary flex items-center justify-center">
          <MessageSquareHeart className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-charcoal">
            Send beta feedback
          </div>
          <div className="text-xs text-charcoal-muted">
            Tell us what's broken, confusing, or missing.
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-charcoal-muted shrink-0" />
      </button>

      <div className="p-4 rounded-2xl bg-muted/40 border border-border text-xs text-charcoal-muted space-y-3">
        <div>
          <div className="font-semibold text-charcoal">Browser permissions</div>
          <p className="mt-0.5">
            Controlled by your browser or device, not by VeggieMeet. We can ask
            once, but only your browser can grant or revoke them.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            <li>
              Location:{" "}
              <span className="text-charcoal font-medium">
                {browserLocationLabel}
              </span>
            </li>
            <li>
              Notifications:{" "}
              <span className="text-charcoal font-medium">
                {browserNotificationLabel}
              </span>
            </li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-charcoal">
            What you last told VeggieMeet
          </div>
          <ul className="mt-1.5 space-y-0.5">
            <li>
              Location:{" "}
              <span className="text-charcoal font-medium">
                {data.privacy.location_permission_result ?? "not asked yet"}
              </span>
            </li>
            <li>
              Notifications:{" "}
              <span className="text-charcoal font-medium">
                {data.privacy.notification_permission_result ?? "not asked yet"}
              </span>
            </li>
          </ul>
          <p className="mt-1.5">
            This is our record of your last answer in the app. It can differ from
            the browser state above, and it doesn't change your browser settings.
          </p>
        </div>
      </div>

    </div>
  );
}

/* ---------- Account ---------- */

function AccountSection({
  data,
  onChanged,
}: {
  data: AccountSettings;
  onChanged: () => void;
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [typedConfirm, setTypedConfirm] = useState("");
  const [blockedInfo, setBlockedInfo] = useState<{
    hosted: number;
    attending: number;
  } | null>(null);

  const del = useMutation({
    mutationFn: requestAccountDeletion,
    onMutate: () => {
      logOnboardingEvent("account_deletion_started", {});
    },
    onSuccess: async (res) => {
      if (res.status === "blocked") {
        logOnboardingEvent("account_deletion_blocked", {
          future_hosted_meetup_count: res.future_hosted_meetup_count,
        });
        setBlockedInfo({
          hosted: res.future_hosted_meetup_count,
          attending: res.future_attendance_count,
        });
        setConfirmOpen(false);
        setTypedConfirm("");
        return;
      }
      logOnboardingEvent("account_deletion_completed", {
        already_deleted: res.status === "already_deleted",
      });
      toast.success(
        res.status === "already_deleted"
          ? "This account was already deleted"
          : "Your account has been deleted",
      );

      setConfirmOpen(false);
      setTypedConfirm("");
      await signOut();
      navigate("/onboarding", { replace: true });
    },
    onError: (e: Error) => toast.error("Couldn't delete", { description: memberSafeMessage(e) }),
  });

  async function handleSignOut() {
    try {
      await signOut();
      logOnboardingEvent("sign_out_completed", {});
      navigate("/onboarding", { replace: true });
    } catch (e) {
      toast.error("Couldn't sign out", {
        description: memberSafeMessage(e),
      });
    }
  }

  const confirmMatches = typedConfirm.trim().toUpperCase() === "DELETE";

  return (
    <div className="space-y-4">
      <Card padding="md" className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-charcoal-muted">
            Email
          </div>
          <div className="text-sm text-charcoal mt-0.5">
            {data.account.email ?? "—"}
          </div>
        </div>
        {data.account.community_guidelines_accepted_at && (
          <div>
            <div className="text-xs uppercase tracking-wider text-charcoal-muted">
              Guidelines accepted
            </div>
            <div className="text-sm text-charcoal mt-0.5">
              {new Date(data.account.community_guidelines_accepted_at).toLocaleDateString()}
            </div>
          </div>
        )}
      </Card>

      <SecondaryButton fullWidth onClick={handleSignOut}>
        <LogOut className="w-4 h-4" /> Sign out
      </SecondaryButton>

      <div className="pt-4 border-t border-border">
        <h2 className="text-xs uppercase tracking-wider text-destructive font-semibold">
          Danger zone
        </h2>
        <p className="text-xs text-charcoal-muted mt-1">
          Your profile and personal account data will be removed and you won't
          be able to sign in again. Some anonymised records may be retained
          where needed for safety and community integrity.

        </p>
        <button
          type="button"
          ref={deleteOpenerRef}
          onClick={() => {
            setTypedConfirm("");
            setConfirmOpen(true);
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 h-12 rounded-xl border border-destructive/40 bg-destructive/5 text-destructive font-semibold hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" /> Delete my account
        </button>

        {blockedInfo && (
          <div className="mt-3 p-4 rounded-xl border border-warning-border bg-warning-soft text-xs text-warning-foreground space-y-3">
            <div>
              You still have <strong>{blockedInfo.hosted}</strong> future{" "}
              {blockedInfo.hosted === 1 ? "Meetup" : "Meetups"} to host. Cancel
              or transfer them first, then try again. Your account has not been
              deleted and you're still signed in.
            </div>
            <button
              type="button"
              onClick={() => navigate("/plans?tab=hosted")}
              className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-warning text-primary-foreground font-semibold hover:opacity-95"
            >
              Manage my Meetups
            </button>
          </div>
        )}
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) {
            setTypedConfirm("");
            // WO-085A DEF-085A-10 (WCAG 2.4.3): the destructive dialog is
            // controlled and its opener lives in a re-rendered panel, so Radix
            // was restoring focus to <body>. Focus returns to the opener.
            requestAnimationFrame(() => deleteOpenerRef.current?.focus());
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your profile, avatar, connections, messages, invitations and
              notifications will be permanently removed, your upcoming Meetups
              will be cancelled, and you'll be signed out for good. Anonymised
              records of Meetups that already happened and of any safety
              reports are kept for the community. This can't be undone.
            </DialogDescription>

          </DialogHeader>

          <div className="space-y-2">
            <Label
              htmlFor="delete-confirm-input"
              className="text-sm font-semibold text-charcoal"
            >
              Type <span className="font-mono">DELETE</span> to confirm
            </Label>
            <Input
              id="delete-confirm-input"
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoCapitalize="characters"
              aria-describedby="delete-confirm-help"
            />
            <p id="delete-confirm-help" className="text-xs text-charcoal-muted">
              Confirmation is case-insensitive.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <SecondaryButton onClick={() => setConfirmOpen(false)}>
              Cancel
            </SecondaryButton>
            <button
              type="button"
              disabled={del.isPending || !confirmMatches}
              onClick={() => del.mutate()}
              aria-label="Delete permanently"
              className="h-11 min-w-11 px-4 rounded-xl bg-destructive text-destructive-foreground font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {del.isPending ? "Deleting…" : "Delete permanently"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Building blocks ---------- */

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** Associates the visible label with its control for screen readers. */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-sm font-semibold text-charcoal">
          {label}
        </Label>
        {hint && <span className="text-[11px] text-charcoal-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ChipGroup({
  options,
  value,
  onChange,
  groupLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  groupLabel?: string;
}) {

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={groupLabel}>

      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(active ? "" : o.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1 px-3 h-11 rounded-full text-sm font-medium border transition-colors ${
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-charcoal border-border hover:bg-accent/40"
            }`}
          >
            {active && <Check className="w-3.5 h-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
