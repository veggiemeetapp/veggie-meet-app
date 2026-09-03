import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// WO-145A: Release N+1 — a new immutable build identity with identical approved
// application behaviour, published to prove the member-consented update path on
// the production origin. No product change.
// WO-122: the single guarded service-worker registration path.
import { registerServiceWorker } from "./lib/registerServiceWorker";

createRoot(document.getElementById("root")!).render(<App />);

registerServiceWorker();

