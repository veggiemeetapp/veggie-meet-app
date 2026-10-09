import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.tsx";
import "./index.css";
// WO-145A: released through the safe coordinated update lifecycle (WO-145).
// WO-122: the single guarded service-worker registration path.
import { registerServiceWorker } from "./lib/registerServiceWorker";
import { clearUpdateNavigationMarker } from "./lib/updateNavigation";

clearUpdateNavigationMarker();
createRoot(document.getElementById("root")!).render(<App />);

// The native bundle is updated through the App Store/Xcode, not through the
// web PWA lifecycle. Registering Workbox inside WKWebView can leave the native
// shell and its cached web assets on different releases.
if (!Capacitor.isNativePlatform()) {
  registerServiceWorker();
}
