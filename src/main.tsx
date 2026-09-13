import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// WO-145A: released through the safe coordinated update lifecycle (WO-145).
// WO-122: the single guarded service-worker registration path.
import { registerServiceWorker } from "./lib/registerServiceWorker";
import { clearUpdateNavigationMarker } from "./lib/updateNavigation";

clearUpdateNavigationMarker();
createRoot(document.getElementById("root")!).render(<App />);

registerServiceWorker();
