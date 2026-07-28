import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ScanLine, Store } from "lucide-react";
import { Card, PrimaryButton, SecondaryButton } from "@/components/app";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { QRScanner } from "@/components/scan/QRScanner";
import { useAuth } from "@/hooks/useAuth";
import { getCommunityPlace, submitPlaceCheckIn } from "@/lib/placeCheckin";
import { toast } from "sonner";

type Mode = "hub" | "scan";

export default function PlaceCheckIn() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { profile, loading } = useAuth();
  const place = useMemo(() => getCommunityPlace(id), [id]);
  const [mode, setMode] = useState<Mode>("hub");
  const [success, setSuccess] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col min-h-dvh items-center justify-center text-sm text-charcoal-muted">
        Loading…
      </div>
    );
  }

  if (!place) {
    return (
      <div className="flex flex-col min-h-dvh">
        <Header onBack={() => navigate(-1)} title="Check In" />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <p className="text-charcoal font-medium">This Community Place isn't available.</p>
          <button onClick={() => navigate("/")} className="mt-4 text-sm font-semibold text-primary">
            Back to Today
          </button>
        </div>
      </div>
    );
  }

  async function handleScanResult(text: string) {
    if (!profile?.id || !place) return;
    const result = await submitPlaceCheckIn({
      profileId: profile.id,
      expectedPlaceId: place.id,
      scannedPayload: text,
    });
    switch (result.kind) {
      case "invalid":
        toast.error("This isn't a valid VeggieMeet Community Place QR code.");
        setMode("hub");
        break;
      case "veggie_qr":
        toast("This QR belongs to a Veggie Check-In.");
        navigate(`/checkin/${result.meetupId}`);
        break;
      case "wrong_place":
        toast.error("That QR is for a different Community Place.");
        setMode("hub");
        break;
      case "unknown_place":
        toast.error("We don't recognize that Community Place.");
        setMode("hub");
        break;
      case "already_today":
        toast("You've already checked in here today.");
        setMode("hub");
        break;
      case "success":
        setSuccess(true);
        setMode("hub");
        break;
    }
  }

  return (
    <div className="flex flex-col min-h-dvh">
      <Header
        onBack={() => (mode === "hub" ? navigate(-1) : setMode("hub"))}
        title={mode === "scan" ? "Scan Venue QR" : "Support This Community Place"}
      />

      {mode === "hub" && (
        <div className="flex-1 px-5 pt-2 pb-10 space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal-muted">{place.name}</p>
            <h2 className="text-2xl font-semibold text-charcoal leading-tight">
              Support This Community Place
            </h2>
            <p className="text-sm text-charcoal-muted leading-relaxed">
              Thanks for supporting veggie-friendly businesses. Scan this venue's VeggieMeet QR code to check in.
            </p>
          </div>

          <Card interactive onClick={() => setMode("scan")} className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <ScanLine className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-charcoal">Scan Venue QR</p>
              <p className="text-xs text-charcoal-muted">Look for the VeggieMeet sticker at the venue</p>
            </div>
          </Card>
        </div>
      )}

      {mode === "scan" && (
        <QRScanner
          onResult={handleScanResult}
          helpText="Point your camera at the venue's VeggieMeet QR code."
          fallbackAction={{ label: "Back", onClick: () => setMode("hub") }}
        />
      )}

      <Dialog open={success} onOpenChange={(open) => !open && setSuccess(false)}>
        <DialogContent className="rounded-3xl border-0 sm:max-w-sm animate-in fade-in-0 zoom-in-95 duration-200">
          <DialogHeader>
            <div className="mx-auto mb-2 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Store className="w-8 h-8" />
            </div>
            <DialogTitle className="text-center text-xl">Community Place Supported</DialogTitle>
            <DialogDescription className="text-center">
              Thanks for supporting {place.name}. Every visit helps strengthen the veggie-friendly ecosystem.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <PrimaryButton fullWidth onClick={() => { setSuccess(false); navigate(`/place/${place.id}`); }}>
              Awesome
            </PrimaryButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="safe-top flex items-center gap-2 px-4 pt-3 pb-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="w-9 h-9 rounded-full flex items-center justify-center text-charcoal hover:bg-muted"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-base font-semibold text-charcoal">{title}</h1>
    </div>
  );
}
