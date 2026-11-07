import { writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const secretNames = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "SUPABASE_WORKER_SIGNING_SECRET",
];

const secrets = Object.fromEntries(
  secretNames.map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing build secret: ${name}`);
    return [name, value];
  }),
);

const file = ".nexora-secrets.json";
writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });

try {
  execSync(
    "npx wrangler deploy --config apps/worker/wrangler.jsonc --secrets-file .nexora-secrets.json",
    { stdio: "inherit" },
  );
} finally {
  try { unlinkSync(file); } catch {}
}
