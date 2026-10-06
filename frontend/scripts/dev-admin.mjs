// Runs the admin panel as its own site: `npm run dev:admin` -> http://localhost:3001
// Same code as the user site, built into its own folder (.next-admin) so both dev servers can
// run side by side. Extra arguments go to `next dev` (e.g. `npm run dev:admin -- -p 4001`).

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const args = process.argv.slice(2);

const child = spawn(process.execPath, [next, "dev", ...(args.includes("-p") ? [] : ["-p", "3001"]), ...args], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_APP_MODE: "admin", NEXT_DIST_DIR: ".next-admin" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
