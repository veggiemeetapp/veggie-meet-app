import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// WO-122: the single guarded service-worker registration path.
import { registerServiceWorker } from "./lib/registerServiceWorker";

createRoot(document.getElementById("root")!).render(<App />);

registerServiceWorker();

