/// <reference types="vite/client" />

// WO-089 — build-time constant injected by Vite (`define`).
declare const __APP_VERSION__: string;

// WO-145D — staged PWA rollout constants injected by Vite (`define`).
declare const __PWA_RELEASE__: string;
declare const __PWA_BRIDGE_ID__: string;
