/// <reference types="vite/client" />

// WO-089 — build-time constant injected by Vite (`define`).
declare const __APP_VERSION__: string;

// WO-145E — PWA release marker injected by Vite (`define`).
declare const __PWA_RELEASE__: string;
