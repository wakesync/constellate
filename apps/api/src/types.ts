export type Env = {
  DB: D1Database;
  RP_ID: string;
  RP_NAME: string;
  APP_ORIGIN: string;
  // Optional comma-separated extra origins for CORS + WebAuthn during transition.
  ALLOWED_ORIGINS?: string;
  ASTRO_URL: string;
  ASTRO_BEARER: string;
  TINFOIL_API_KEY?: string;
  TINFOIL_MODEL?: string;
};

export type Authed = {
  userId: string;
};
