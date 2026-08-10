import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { PrimaryButton, SecondaryButton } from "@/components/app";

interface Props {
  /** Called with the raw decoded QR text. Fires only once per mount unless `reset` is bumped. */
  onResult: (text: string) => void;
  /** Optional helper copy shown above the scanner viewport. */
  helpText?: string;
  /** Optional secondary action shown in the error state (e.g. "Show my code"). */
  fallbackAction?: { label: string; onClick: () => void };
}

/**
 * Reusable camera-based QR scanner. One implementation for all VeggieMeet
 * check-in flows (Veggie Check-In, Community Place Check-In, …).
 */
export function QRScanner({ onResult, helpText, fallbackAction }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [attempt, setAttempt] = useState(0);
  const handledRef = useRef(false);
  const elementId = useMemo(() => `qr-reader-${Math.random().toString(36).slice(2)}`, []);

  const start = useCallback(async () => {
    setStatus("starting");
    setErrorMsg("");
    handledRef.current = false;

    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (!document.getElementById(elementId)) {
      setErrorMsg("We couldn't start your camera.");
      setStatus("error");
      return;
    }

    try {
      const instance = new Html5Qrcode(elementId, { verbose: false });
      scannerRef.current = instance;
      await instance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (handledRef.current) return;
          handledRef.current = true;
          onResult(decoded);
        },
        () => {},
      );
      setStatus("ready");
    } catch (e: any) {
      const name = e?.name || "";
      const msg =
        name === "NotAllowedError"
          ? "Camera access was blocked. Enable it in your browser settings and try again."
          : name === "NotFoundError"
          ? "We couldn't find a camera on this device."
          : "We couldn't start your camera.";
      setErrorMsg(msg);
      setStatus("error");
    }
  }, [elementId, onResult]);

  useEffect(() => {
    start();
    return () => {
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        try {
          if (s.isScanning) {
            s.stop().then(() => s.clear()).catch(() => {});
          } else {
            s.clear();
          }
        } catch {}
      }
    };
  }, [start, attempt]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 pb-10 gap-4">
      {helpText && (
        <p className="text-sm text-charcoal-muted text-center max-w-xs">{helpText}</p>
      )}
      <div className="w-full aspect-square rounded-dialog overflow-hidden bg-charcoal relative">
        <div id={elementId} className="w-full h-full" />
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center text-warm-white/80 text-sm">
            Starting camera…
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-charcoal/95 text-warm-white page-x text-center">
            <p className="text-base font-semibold">Camera unavailable</p>
            <p className="text-sm text-warm-white/80">{errorMsg}</p>
          </div>
        )}
      </div>
      {status === "error" && (
        <div className="w-full flex flex-col gap-2">
          <PrimaryButton fullWidth onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </PrimaryButton>
          {fallbackAction && (
            <SecondaryButton fullWidth onClick={fallbackAction.onClick}>
              {fallbackAction.label}
            </SecondaryButton>
          )}
        </div>
      )}
    </div>
  );
}
