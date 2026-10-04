// Telegram HTML is applied after translation so DESCO values and user input
// cannot become markup. The English text remains the canonical report format.
const bn = [
  ["⚡ Zeus DescoBuddy", "⚡ জিউস ডেসকোবাডি"],
  [
    "Connect only your own meter:",
    "শুধু নিজের বা অনুমতিপ্রাপ্ত মিটার যুক্ত করুন:",
  ],
  [
    "Times are Bangladesh time. DESCO may publish readings late. Each user's data is separate. Free hosting has capacity limits.",
    "সব সময় বাংলাদেশ সময়। ডেসকোর তথ্য আসতে দেরি হতে পারে। প্রত্যেকের তথ্য আলাদা। বিনামূল্যের সেবায় ব্যবহারকারীর সীমা আছে।",
  ],
  ["⚡ DESCO status", "⚡ ডেসকো হিসাব"],
  ["📥 New DESCO reading", "📥 ডেসকোর নতুন রিডিং"],
  ["⚙️ Settings", "⚙️ সেটিংস"],
  ["📊 Usage:", "📊 বিদ্যুৎ ব্যবহার:"],
  ["📒 Usage history", "📒 ব্যবহারের ইতিহাস"],
  ["📜 Recharges", "📜 রিচার্জের ইতিহাস"],
  ["💳 Recharge", "💳 রিচার্জ"],
  ["🔎 Receipt checks", "🔎 রসিদ পরীক্ষা"],
  ["⚠️ Balance below", "⚠️ ব্যালেন্স নেমেছে"],
  ["⚡ Balance reading after recharge", "⚡ রিচার্জের পরের ব্যালেন্স"],
  ["🔄 Missing readings arrived", "🔄 অপেক্ষার রিডিং এসেছে"],
  ["Day ", "দিন "],
  ["Updated ", "সংশোধিত "],
  ["Meter reading:", "মিটারের রিডিং:"],
  ["DESCO reading:", "ডেসকোর রিডিং:"],
  ["DESCO updated:", "ডেসকো আপডেট:"],
  ["Balance:", "ব্যালেন্স:"],
  ["Latest balance:", "সর্বশেষ ব্যালেন্স:"],
  ["Spent this month:", "এই মাসে খরচ:"],
  ["Today so far:", "আজকের খরচ এখন পর্যন্ত:"],
  ["Latest day", "সর্বশেষ দিন"],
  ["Today's reading is pending.", "আজকের রিডিং এখনো আসেনি।"],
  ["No complete daily reading yet.", "সম্পূর্ণ দৈনিক রিডিং এখনো আসেনি।"],
  ["Price/kWh is the day's average.", "প্রতি ইউনিটের দাম হলো ওই দিনের গড়।"],
  ["Today's total can change.", "আজকের মোট খরচ বদলাতে পারে।"],
  ["Usage checked:", "তথ্য যাচাই:"],
  ["Days received:", "যত দিনের তথ্য পাওয়া গেছে:"],
  ["Cost for available days:", "পাওয়া দিনের মোট খরচ:"],
  ["Waiting for DESCO", "ডেসকোর তথ্যের অপেক্ষায়"],
  ["Pending", "অপেক্ষায়"],
  ["Account:", "অ্যাকাউন্ট:"],
  ["Language:", "ভাষা:"],
  ["Timezone:", "সময় অঞ্চল:"],
  ["Schedule:", "সময়সূচি:"],
  ["Automatic messages:", "স্বয়ংক্রিয় বার্তা:"],
  ["Background checks:", "নিয়মিত পরীক্ষা:"],
  ["Recharge alerts:", "রিচার্জ সতর্কতা:"],
  ["Low balance alerts:", "কম ব্যালেন্সের সতর্কতা:"],
  ["Default alerts:", "নিয়মিত সতর্কতা:"],
  ["Extra balance alert:", "অতিরিক্ত ব্যালেন্স সতর্কতা:"],
  ["Receipt mismatch alert:", "রসিদের অমিলের সতর্কতা:"],
  [
    "readings, recharges, below ৳500/৳300/৳200",
    "নতুন রিডিং, রিচার্জ, ৳৫০০/৳৩০০/৳২০০-এর নিচে ব্যালেন্স",
  ],
  ["approximately", "প্রায়"],
  [
    "minutes; may take longer at free-plan capacity.",
    "মিনিট; বিনামূল্যের সেবায় বেশি সময় লাগতে পারে।",
  ],
  ["Date:", "তারিখ:"],
  ["Status:", "অবস্থা:"],
  ["Paid:", "জমা দিয়েছেন:"],
  ["Electricity credit:", "বিদ্যুতের জন্য জমা:"],
  ["VAT:", "ভ্যাট:"],
  ["Rebate:", "ছাড়:"],
  ["Other charges total:", "অন্যান্য চার্জের মোট:"],
  ["Deduction:", "কর্তন:"],
  ["Reading:", "রিডিং:"],
  ["✅ Receipt amounts add up.", "✅ রসিদের টাকার হিসাব মিলেছে।"],
  ["⚠️ Receipt difference:", "⚠️ রসিদের টাকায় পার্থক্য:"],
  ["Receipt difference", "রসিদের পার্থক্য"],
  [
    "Receipt check pending: missing details.",
    "রসিদের কিছু তথ্য নেই; পরীক্ষা বাকি।",
  ],
  [
    "⏳ Waiting for a reading after this recharge.",
    "⏳ এই রিচার্জের পরের রিডিংয়ের অপেক্ষায়।",
  ],
  ["Balance + credits:", "ব্যালেন্স ও জমার যোগফল:"],
  [
    "Estimate before later usage/fees; assumes credits reached the meter.",
    "পরের ব্যবহার/চার্জ বাদ নেই; টাকা মিটারে পৌঁছেছে ধরে নেওয়া হয়েছে।",
  ],
  ["Includes any usage since payment.", "টাকা দেওয়ার পরের ব্যবহারও এতে আছে।"],
  ["Checked:", "পরীক্ষা করা হয়েছে:"],
  ["Amounts match:", "হিসাব মিলেছে:"],
  ["Differences:", "পার্থক্য:"],
  ["Missing details:", "তথ্য নেই:"],
  [
    "A match checks receipt arithmetic, not tariff legality or meter accuracy. Independent tariff checks are not enabled.",
    "রসিদের যোগফল মিললেও বিদ্যুতের দাম বা মিটারের নির্ভুলতা প্রমাণ হয় না। স্বতন্ত্র ট্যারিফ পরীক্ষা চালু নেই।",
  ],
  [
    "Balance check: waiting for two fresh readings.",
    "ব্যালেন্স যাচাইয়ে দুটি নতুন রিডিং দরকার।",
  ],
  [
    "Balance check: readings cannot be compared yet.",
    "ব্যালেন্সের রিডিং এখনো তুলনা করা যাচ্ছে না।",
  ],
  [
    "Balance check: waiting for readings clear of the recharge period.",
    "রিচার্জের সময়ের বাইরের রিডিংয়ের অপেক্ষায়।",
  ],
  [
    "Balance check: missing or corrected readings.",
    "রিডিং নেই বা সংশোধন হয়েছে।",
  ],
  [
    "Balance change matches DESCO’s reported cost.",
    "ব্যালেন্সের পরিবর্তন ডেসকোর খরচের সঙ্গে মিলেছে।",
  ],
  ["Balance/cost difference:", "ব্যালেন্স ও খরচের পার্থক্য:"],
  [
    "Timing or missing adjustments may explain this; needs checking.",
    "সময় বা অনুপস্থিত সমন্বয়ের কারণে হতে পারে; যাচাই দরকার।",
  ],
  [
    "Some data could not refresh; check is incomplete.",
    "কিছু তথ্য নতুন করে পাওয়া যায়নি; পরীক্ষা অসম্পূর্ণ।",
  ],
  ["Refresh failed:", "নতুন তথ্য পাওয়া যায়নি:"],
  ["Saved readings shown.", "সংরক্ষিত রিডিং দেখানো হয়েছে।"],
  [
    "Using saved daily readings; refresh failed.",
    "সংরক্ষিত দৈনিক রিডিং দেখানো হয়েছে; নতুন তথ্য আসেনি।",
  ],
  ["Using saved receipts.", "সংরক্ষিত রসিদ দেখানো হচ্ছে।"],
  [
    "No recharge received in the last 35 days.",
    "গত ৩৫ দিনে কোনো রিচার্জ পাওয়া যায়নি।",
  ],
  ["No records received.", "কোনো তথ্য পাওয়া যায়নি।"],
  [
    "Saved data; refresh failed.",
    "সংরক্ষিত তথ্য দেখানো হচ্ছে; নতুন তথ্য আসেনি।",
  ],
  [
    "Recharge: none yet this month (earlier balance may carry over).",
    "রিচার্জ: এই মাসে নেই (আগের ব্যালেন্স থাকতে পারে)।",
  ],
  ["Recharge:", "রিচার্জ:"],
  ["Days:", "দিন অনুযায়ী খরচ:"],
  ["Other attempt:", "অন্য রিচার্জ চেষ্টা:"],
  ["Receipt needs checking.", "রসিদ যাচাই দরকার।"],
  [
    "Recharge-day usage includes time before payment. Same-day recharges share one daily group. Groups don't prove which credit paid for each day's usage.",
    "রিচার্জের দিনের খরচে টাকা দেওয়ার আগের ব্যবহারও আছে। একই দিনের রিচার্জ একসঙ্গে দেখানো হয়। কোন রিচার্জের টাকা কোন দিনে খরচ হয়েছে, এটি নিশ্চিত করে না।",
  ],
  ["Connected ✅", "সংযোগ হয়েছে ✅"],
  [
    "Use /schedule daily 08:00 for reports.",
    "নিয়মিত খবর পেতে /schedule daily 08:00 দিন।",
  ],
  ["Automatic messages paused.", "স্বয়ংক্রিয় বার্তা বন্ধ হয়েছে।"],
  ["Automatic messages resumed.", "স্বয়ংক্রিয় বার্তা চালু হয়েছে।"],
  ["Scheduled reports off.", "নিয়মিত রিপোর্ট বন্ধ হয়েছে।"],
  ["Alert setting saved.", "সতর্কতার সেটিং সংরক্ষিত।"],
  [
    "Your extra reports and alerts are off. New readings, recharges and the ৳500/৳300/৳200 balance alerts continue.",
    "আপনার বাড়তি রিপোর্ট ও সতর্কতা বন্ধ। নতুন রিডিং, রিচার্জ এবং ৳৫০০/৳৩০০/৳২০০ ব্যালেন্স সতর্কতা চালু থাকবে।",
  ],
  [
    "Extra reports and alerts are off. All automatic messages are paused; send /resume for the default notices.",
    "বাড়তি রিপোর্ট ও সতর্কতা বন্ধ। সব স্বয়ংক্রিয় বার্তা বিরত আছে; নিয়মিত খবর পেতে /resume দিন।",
  ],
  [
    "Extra balance alert removed. Default ৳500/৳300/৳200 alerts stay enabled.",
    "বাড়তি ব্যালেন্স সতর্কতা সরানো হয়েছে। ৳৫০০/৳৩০০/৳২০০-এর নিয়মিত সতর্কতা চালু আছে।",
  ],
  [
    "Default ৳500/৳300/৳200 alerts continue.",
    "৳৫০০/৳৩০০/৳২০০-এর নিয়মিত সতর্কতা চালু থাকবে।",
  ],
  ["Extra balance alert set at", "বাড়তি ব্যালেন্স সতর্কতার সীমা"],
  ["Extra receipt mismatch alert on.", "রসিদের অমিলের বাড়তি সতর্কতা চালু।"],
  [
    "Extra receipt mismatch alert off. Default updates continue.",
    "রসিদের অমিলের বাড়তি সতর্কতা বন্ধ। নিয়মিত খবর চালু থাকবে।",
  ],
  [
    "Recharge notices are part of default updates and stay on. /pause stops all automatic messages.",
    "রিচার্জের খবর নিয়মিত আপডেটের অংশ, তাই চালু থাকবে। /pause দিলে সব স্বয়ংক্রিয় বার্তা বন্ধ হয়।",
  ],
  [
    "Default alerts: new readings, recharges, and below ৳500/৳300/৳200. Use /alerts low 600 for an extra balance alert or /alerts mismatch on for receipt checks.",
    "নিয়মিত সতর্কতা: নতুন রিডিং, রিচার্জ, ৳৫০০/৳৩০০/৳২০০-এর নিচে ব্যালেন্স। বাড়তি সীমার জন্য /alerts low 600 বা রসিদ যাচাইয়ের জন্য /alerts mismatch on দিন।",
  ],
  ["Extra settings: schedule", "বাড়তি সেটিংস: সময়সূচি"],
  ["balance", "ব্যালেন্স"],
  ["receipt mismatch", "রসিদের অমিল"],
  [
    "Use /extras off to remove them; default updates continue.",
    "এগুলো বন্ধ করতে /extras off দিন; নিয়মিত খবর চালু থাকবে।",
  ],
  [
    "Use /alerts low 600, /alerts low off, /alerts mismatch on, or /alerts mismatch off. Default notices stay on.",
    "বাড়তি সতর্কতার জন্য /alerts low 600, /alerts low off, /alerts mismatch on বা /alerts mismatch off দিন। নিয়মিত খবর চালু থাকবে।",
  ],
  ["Reports set:", "রিপোর্টের সময়:"],
  [
    "Bangladesh time. Delivery can be delayed by free hosting or DESCO.",
    "বাংলাদেশ সময়। বিনামূল্যের সেবা বা ডেসকোর কারণে দেরি হতে পারে।",
  ],
  [
    "Please wait a few seconds between commands.",
    "দুইটি কমান্ডের মাঝে কয়েক সেকেন্ড অপেক্ষা করুন।",
  ],
  ["Connect first:", "আগে মিটার যুক্ত করুন:"],
  [
    "Use /disconnect before switching meters.",
    "অন্য মিটার যুক্ত করতে আগে /disconnect দিন।",
  ],
  [
    "Only connect a meter you own or have permission to manage.",
    "শুধু নিজের বা অনুমতিপ্রাপ্ত মিটার যুক্ত করুন।",
  ],
  [
    "Use /connect ACCOUNT_NUMBER METER_NUMBER",
    "লিখুন /connect ACCOUNT_NUMBER METER_NUMBER",
  ],
  [
    "Remove your saved meter, readings and schedules? Send /disconnect confirm. Telegram chat messages remain.",
    "সংরক্ষিত মিটার, রিডিং ও সময়সূচি মুছবেন? /disconnect confirm দিন। টেলিগ্রামের পুরোনো বার্তা থাকবে।",
  ],
  [
    "Your saved meter data and schedules were removed. /connect to start again.",
    "সংরক্ষিত মিটার ও সময়সূচি মুছে গেছে। আবার শুরু করতে /connect দিন।",
  ],
  [
    "Your saved financial readings. Keep this file private.",
    "আপনার সংরক্ষিত হিসাব। ফাইলটি গোপন রাখুন।",
  ],
  [
    "This free instance has reached its user capacity. Please try later.",
    "বিনামূল্যের সেবায় ব্যবহারকারীর সীমা পূর্ণ। পরে চেষ্টা করুন।",
  ],
  [
    "Choose /language bn for বাংলা or /language en for English.",
    "বাংলার জন্য /language bn, ইংরেজির জন্য /language en দিন।",
  ],
  [
    "Use /language bn or /language en.",
    "লিখুন /language bn অথবা /language en।",
  ],
  [
    "Use /schedule daily 08:00 or /schedule weekly fri 20:00 (Bangladesh time).",
    "বাংলাদেশ সময়ে /schedule daily 08:00 অথবা /schedule weekly fri 20:00 দিন।",
  ],
  [
    "Use /alerts low default, /alerts low 600, /alerts low off, /alerts recharge on, or /alerts mismatch on.",
    "লিখুন /alerts low default, /alerts low 600, /alerts low off, /alerts recharge on অথবা /alerts mismatch on।",
  ],
  [
    "Finished clearing eligible recent messages.",
    "মোছা যায় এমন সাম্প্রতিক বার্তা মুছে গেছে।",
  ],
  [
    "Telegram could not delete some messages.",
    "টেলিগ্রাম কিছু বার্তা মুছতে পারেনি।",
  ],
  [
    "Only recent messages can be deleted by bots (up to 1,000 IDs per request). Use Telegram Clear History for the entire chat. Your meter data is kept.",
    "বট শুধু সাম্প্রতিক বার্তা মুছতে পারে। পুরো চ্যাট মুছতে Telegram Clear History ব্যবহার করুন। মিটারের তথ্য রাখা হয়েছে।",
  ],
  ["Use /usage_history YYYY-MM.", "লিখুন /usage_history YYYY-MM।"],
  ["Choose this month or an earlier month.", "এই মাস বা আগের মাস বেছে নিন।"],
  ["Unknown meter system.", "মিটারের ধরন চেনা যায়নি।"],
  ["DESCO could not provide this record.", "ডেসকো এই তথ্য দিতে পারেনি।"],
  [
    "Cannot reach DESCO securely right now. Please retry.",
    "এখন নিরাপদভাবে ডেসকোতে পৌঁছানো যাচ্ছে না। আবার চেষ্টা করুন।",
  ],
  [
    "No matching balance reading received.",
    "এই মিটারের ব্যালেন্স রিডিং পাওয়া যায়নি।",
  ],
  [
    "Could not confirm that account and meter pair. Check both numbers or retry later.",
    "অ্যাকাউন্ট ও মিটার নম্বর মেলেনি। নম্বর দুটি দেখুন বা পরে চেষ্টা করুন।",
  ],
  [
    "Daily readings are temporarily missing.",
    "দৈনিক রিডিং এখন পাওয়া যাচ্ছে না।",
  ],
  [
    "Recharge history is temporarily missing.",
    "রিচার্জের ইতিহাস এখন পাওয়া যাচ্ছে না।",
  ],
  ["Please retry.", "আবার চেষ্টা করুন।"],
  ["Demand Charge", "ডিমান্ড চার্জ"],
  ["Meter Rent", "মিটার ভাড়া"],
  ["Energy Cost", "বিদ্যুতের খরচ"],
  ["Dhaka", "ঢাকা"],
  ["latest recharge", "সর্বশেষ রিচার্জ"],
  ["last 35 days", "গত ৩৫ দিন"],
  ["this month", "এই মাস"],
  ["choose a month", "মাস বেছে নিন"],
  [
    "recent messages (Telegram limits apply)",
    "সাম্প্রতিক বার্তা (টেলিগ্রামের সীমা আছে)",
  ],
  ["remove your meter data", "মিটারের তথ্য মুছুন"],
  ["Used", "ব্যবহৃত"],
  ["Successful", "সফল"],
];
const bnLongestFirst = [...bn].sort((a, b) => b[0].length - a[0].length);

const helpBn = `⚡ জিউস ডেসকোবাডি
শুধু নিজের বা অনুমতিপ্রাপ্ত মিটার যুক্ত করুন:
/connect ACCOUNT_NUMBER METER_NUMBER

/status — ব্যালেন্স ও সর্বশেষ খরচ
/today — আজ বা সর্বশেষ দিনের খরচ
/week · /month — সপ্তাহ ও মাসের হিসাব
/recharges — সর্বশেষ রিচার্জ
/history — রিচার্জের ইতিহাস
/usage_history — এই মাসের খরচ
/usage_history 2026-10 — নির্দিষ্ট মাস
/audit — রসিদের হিসাব যাচাই
/export — তথ্য ডাউনলোড

/schedule daily 08:00 — দৈনিক খবর
/schedule weekly fri 20:00 — সাপ্তাহিক খবর
/schedule off — নিয়মিত খবর বন্ধ
/alerts low 600 — বাড়তি ব্যালেন্স সীমা
/alerts low off — বাড়তি সীমা সরান
/alerts mismatch on — রসিদের অমিল
/extras off — বাড়তি রিপোর্ট ও সতর্কতা বন্ধ
/language en — English
/pause · /resume · /settings
/clear — সাম্প্রতিক বার্তা মুছুন
/disconnect — মিটারের তথ্য মুছুন

সব সময় বাংলাদেশ সময়। ডেসকোর তথ্য আসতে দেরি হতে পারে।`;

const html = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function translate(text, language = "en") {
  if (language !== "bn") return text;
  if (text.startsWith("⚡ Zeus DescoBuddy\n")) return helpBn;
  return bnLongestFirst
    .reduce(
      (value, [english, bangla]) => value.replaceAll(english, bangla),
      text,
    )
    .replace(/: on\b/g, ": চালু")
    .replace(/: off\b/g, ": বন্ধ")
    .replace(/: paused\b/g, ": বিরত")
    .replace(/: daily\b/g, ": দৈনিক")
    .replace(/: weekly\b/g, ": সাপ্তাহিক");
}

const buttonsBn = new Map([
  ["⚡ Status", "⚡ অবস্থা"],
  ["📊 Today", "📊 আজ"],
  ["💳 Latest recharge", "💳 সর্বশেষ রিচার্জ"],
  ["📒 Usage history", "📒 ব্যবহারের ইতিহাস"],
  ["📜 Recharge history", "📜 রিচার্জের ইতিহাস"],
  ["🔎 Audit", "🔎 হিসাব যাচাই"],
  ["🔕 Stop extras", "🔕 বাড়তি খবর বন্ধ"],
]);
export function localizeMarkup(markup, language = "en") {
  if (language !== "bn" || !markup?.inline_keyboard) return markup;
  return {
    ...markup,
    inline_keyboard: markup.inline_keyboard.map((row) =>
      row.map((button) => ({
        ...button,
        text: buttonsBn.get(button.text) || button.text,
      })),
    ),
  };
}

export function renderMessage(text, language = "en") {
  const lines = translate(text, language).split("\n");
  return lines
    .map((line, index) => {
      const escaped = html(line);
      if (!line.trim()) return escaped;
      if (index === 0) return `<b>${escaped}</b>`;
      const colon = line.indexOf(":");
      if (colon > 0 && colon < 35 && !line.startsWith("/"))
        return `<b>${html(line.slice(0, colon + 1))}</b>${html(line.slice(colon + 1))}`;
      return escaped;
    })
    .join("\n");
}
