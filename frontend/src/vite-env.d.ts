/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in zero-backend demo builds (npm run demo:build). */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
