import { readFile } from "node:fs/promises";
import { COMMANDS } from "../src/worker.js";
const url = new URL(process.argv[2] || "https://invalid.example");
if (
  url.protocol !== "https:" ||
  !url.hostname.endsWith(".workers.dev") ||
  url.pathname !== "/"
)
  throw new Error("Pass the deployed https://NAME.SUBDOMAIN.workers.dev URL.");
const secrets = JSON.parse(
  await readFile(new URL("../.cloud-secrets.json", import.meta.url), "utf8"),
);
const check = await fetch(new URL("/ready", url), {
  method: "POST",
  headers: { "X-Telegram-Bot-Api-Secret-Token": secrets.WEBHOOK_SECRET },
  signal: AbortSignal.timeout(60000),
});
if (!check.ok)
  throw new Error(
    "Cloud readiness check failed; webhook was not changed. Verify DESCO HTTPS, D1 and Telegram secrets.",
  );
async function tg(method, body) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = await response.json();
    if (!result.ok) throw new Error();
    return result.result;
  } catch {
    throw new Error(`Telegram ${method} failed; secrets were not logged.`);
  }
}
await tg("setMyCommands", {
  commands: Object.entries(COMMANDS).map(([command, description]) => ({
    command,
    description,
  })),
});
await tg("setMyCommands", {
  language_code: "bn",
  commands: Object.entries(COMMANDS).map(([command]) => ({
    command,
    description:
      {
        start: "শুরু করুন",
        connect: "নিজের মিটার যুক্ত করুন",
        status: "ব্যালেন্স ও সর্বশেষ খরচ",
        today: "আজকের বা সর্বশেষ খরচ",
        week: "সপ্তাহের ব্যবহার",
        month: "মাসের ব্যবহার",
        recharges: "সর্বশেষ রিচার্জ",
        history: "রিচার্জের ইতিহাস",
        usage_history: "রিচার্জ ও খরচের ইতিহাস",
        audit: "হিসাব যাচাই",
        schedule: "রিপোর্টের সময় ঠিক করুন",
        alerts: "সতর্কতা ঠিক করুন",
        language: "বাংলা বা ইংরেজি বেছে নিন",
        settings: "সেটিংস দেখুন",
        pause: "স্বয়ংক্রিয় বার্তা বন্ধ",
        resume: "স্বয়ংক্রিয় বার্তা চালু",
        disconnect: "মিটারের তথ্য মুছুন",
        clear: "সাম্প্রতিক বার্তা মুছুন",
        export: "তথ্য ডাউনলোড",
        help: "সাহায্য দেখুন",
      }[command] || "সাহায্য",
  })),
});
await tg("setWebhook", {
  url: new URL("/telegram", url).href,
  secret_token: secrets.WEBHOOK_SECRET,
  max_connections: 5,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
});
const info = await tg("getWebhookInfo", {});
if (info.url !== new URL("/telegram", url).href)
  throw new Error("Webhook verification failed.");
console.log(
  "Webhook registered. Now verify /start, /connect ACCOUNT METER and /status from Telegram.",
);
console.log(
  "Old local readings remain on your PC; this cloud database starts separately.",
);
