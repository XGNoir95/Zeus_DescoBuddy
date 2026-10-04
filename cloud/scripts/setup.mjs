// Run only on the owner's computer. Secrets never enter command-line arguments.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
function wrangler(args, input) {
  const result = spawnSync(
    process.execPath,
    [
      new URL(
        "../node_modules/wrangler/bin/wrangler.js",
        import.meta.url,
      ).pathname.replace(/^\/([A-Z]:)/i, "$1"),
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      input,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  if (result.status !== 0)
    throw new Error(
      `Cloudflare ${args[0]} failed. Sign in with npx wrangler login and retry. Details were not printed to avoid leaking secrets.`,
    );
  return result.stdout;
}
const auth = wrangler(["whoami"]);
if (auth.includes("not authenticated"))
  throw new Error("Run npx wrangler login first.");
const path = new URL("../wrangler.jsonc", import.meta.url),
  config = JSON.parse(await readFile(path, "utf8"));
if (
  config.d1_databases[0].database_id === "00000000-0000-0000-0000-000000000000"
) {
  const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
  const existing = databases.find((d) => d.name === "zeus-descobuddy");
  if (existing)
    config.d1_databases[0].database_id = existing.uuid || existing.id;
  else {
    const output = wrangler([
      "d1",
      "create",
      "zeus-descobuddy",
      "--location",
      "apac",
    ]);
    const match = output.match(/database_id["\s:=]+([a-f0-9-]{36})/i);
    if (!match)
      throw new Error(
        "Database created, but UUID could not be read. Copy its ID into wrangler.jsonc; do not create another database.",
      );
    config.d1_databases[0].database_id = match[1];
  }
  await writeFile(path, JSON.stringify(config, null, 2) + "\n");
}
const secretPath = new URL("../.cloud-secrets.json", import.meta.url);
wrangler(["d1", "migrations", "apply", "zeus-descobuddy", "--remote"]);
let secrets;
try {
  secrets = JSON.parse(await readFile(secretPath, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT")
    throw new Error(
      "Existing .cloud-secrets.json is not valid JSON. Preserve it and repair it; do not regenerate DATA_KEY.",
    );
  const counts = JSON.parse(
    wrangler([
      "d1",
      "execute",
      "zeus-descobuddy",
      "--remote",
      "--command",
      "SELECT COUNT(*) AS n FROM users",
      "--json",
    ]),
  );
  if (counts[0]?.results?.[0]?.n !== 0)
    throw new Error(
      "Cloud data already exists. Restore .cloud-secrets.json from your private backup; setup will not replace the encryption key.",
    );
  let existingSecrets = [];
  try {
    existingSecrets = JSON.parse(wrangler(["secret", "list"]));
  } catch {}
  if (existingSecrets.some((s) => s.name === "DATA_KEY"))
    throw new Error(
      "An existing cloud encryption key exists. Restore your private .cloud-secrets.json backup before running setup; do not replace DATA_KEY.",
    );
  const env = await readFile(new URL("../../.env", import.meta.url), "utf8");
  const match = env.match(
    /^TELEGRAM_BOT_TOKEN\s*=\s*['"]?([^'"\r\n]+)['"]?\s*$/m,
  );
  if (!match)
    throw new Error(
      "Configure the Telegram token in the local project .env first.",
    );
  secrets = {
    TELEGRAM_BOT_TOKEN: match[1].trim(),
    WEBHOOK_SECRET: randomBytes(32).toString("hex"),
    DATA_KEY: randomBytes(32).toString("base64"),
  };
  await writeFile(secretPath, JSON.stringify(secrets, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
wrangler(["deploy"]);
wrangler(["secret", "bulk"], JSON.stringify(secrets));
console.log(
  "Worker, database, and secrets installed. Preserve cloud/.cloud-secrets.json privately; DATA_KEY must not change.",
);
console.log(
  "Next: stop the CMD bot and run npm run activate -- https://YOUR-WORKER.workers.dev",
);
console.log(
  "For CI set repository variables CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and secret CLOUDFLARE_API_TOKEN.",
);
console.log("D1 database ID:", config.d1_databases[0].database_id);
