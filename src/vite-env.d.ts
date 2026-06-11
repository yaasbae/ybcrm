/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHATWOOT_WEBSITE_TOKEN?: string;
  readonly VITE_CHATWOOT_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
