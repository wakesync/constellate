// Cloudflare Worker entry. Serves the SPA from /dist (assets binding) and adds
// security + caching headers. SPA fallback is handled by the [assets]
// not_found_handling = "single-page-application" config in wrangler.toml.

export interface Env {
  ASSETS: Fetcher;
  // Bind only an isolated product API, never the live product by default.
  PRODUCT_API?: Fetcher;
}

// Long-cache hashed build assets; never long-cache HTML or the service worker.
function withHeaders(req: Request, res: Response): Response {
  const url = new URL(req.url);
  const headers = new Headers(res.headers);

  // Security headers (the app is a self-contained SPA; tighten where safe).
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

  // Caching policy.
  const path = url.pathname;
  if (path === "/sw.js") {
    headers.set("Cache-Control", "no-cache");
  } else if (path === "/" || path.endsWith(".html") || !path.includes(".")) {
    // HTML + SPA routes: always revalidate so deploys take effect immediately.
    headers.set("Cache-Control", "no-cache");
  } else if (/\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(path)) {
    // Vite emits content-hashed asset names; safe to cache for a long time.
    if (/[.-][0-9a-f]{8,}\./.test(path)) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      headers.set("Cache-Control", "public, max-age=3600");
    }
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/product-api" || url.pathname.startsWith("/product-api/")) {
      if (!env.PRODUCT_API) return Response.json({ error: "Product API not configured" }, { status: 503 });
      url.pathname = url.pathname.slice("/product-api".length) || "/";
      return env.PRODUCT_API.fetch(new Request(url, req));
    }
    const res = await env.ASSETS.fetch(req);
    return withHeaders(req, res);
  },
};
