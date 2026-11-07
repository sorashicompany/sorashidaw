import { execSync } from "node:child_process";

execSync("pnpm --filter @nexoradaw/web build", { stdio: "inherit" });
execSync(
  "npx wrangler deploy --config apps/worker/wrangler.jsonc",
  { stdio: "inherit" },
);
