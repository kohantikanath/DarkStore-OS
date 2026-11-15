/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  // "true" to answer every API call with MSW and every live event over
  // BroadcastChannel instead of a real backend — any other value (including
  // unset) means use the real one. A plain string, not a boolean: Vite env
  // vars always are.
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
