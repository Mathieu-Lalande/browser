/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Crash report endpoint baked in at build time (ADR-043): an https URL or a Sentry DSN. */
  readonly MAIN_VITE_CRASH_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
