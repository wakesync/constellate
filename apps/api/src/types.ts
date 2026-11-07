export type Env = {
  DB: D1Database;
  RP_ID: string;
  RP_NAME: string;
  APP_ORIGIN: string;
  // Optional comma-separated extra origins for CORS + WebAuthn during transition.
  ALLOWED_ORIGINS?: string;
  ASTRO_URL: string;
  ASTRO_BEARER: string;
  OPENROUTER_API_KEY: string;
  // Anthropic-compatible pool key (POOL_URL). When set, readings burn pooled
  // subscription quota instead of per-token OpenRouter billing.
  POOL_API_KEY: string;
  POOL_URL?: string;
};

export type Authed = {
  userId: string;
};
