/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "1" when building the app for the e2e suite (see e2e/run-in-docker.sh). */
  readonly VITE_E2E?: string;
}
