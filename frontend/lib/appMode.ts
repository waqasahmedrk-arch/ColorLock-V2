// The same code runs as two sites: the user site (`npm run dev`, :3000) and the admin panel
// (`npm run dev:admin`, :3001). scripts/dev-admin.mjs sets NEXT_PUBLIC_APP_MODE=admin.
// NEXT_PUBLIC_ values are inlined when each server compiles, so both sites can read them
// in client code too. Both sites share the API's session cookie (cookies aren't port-scoped).

export const IS_ADMIN_APP = process.env.NEXT_PUBLIC_APP_MODE === "admin";

// Where each site lives, for links from one to the other.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
