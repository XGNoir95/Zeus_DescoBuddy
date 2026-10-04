import { readFile, writeFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
const file = new URL("../wrangler.jsonc", import.meta.url);
const config = parse(await readFile(file, "utf8"));
if (!/^[a-f0-9-]{36}$/i.test(process.env.CLOUDFLARE_D1_DATABASE_ID || ""))
  throw new Error("Set CLOUDFLARE_D1_DATABASE_ID to the provisioned D1 UUID.");
config.d1_databases[0].database_id = process.env.CLOUDFLARE_D1_DATABASE_ID;
await writeFile(file, JSON.stringify(config, null, 2) + "\n");
