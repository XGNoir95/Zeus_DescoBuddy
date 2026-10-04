import test from "node:test";
import assert from "node:assert/strict";
import { renderMessage } from "../src/i18n.js";

test("Telegram hierarchy escapes source values and Bangla keeps commands", () => {
  assert.equal(
    renderMessage('⚡ DESCO status\nAccount: <script>& "hello"'),
    "<b>⚡ DESCO status</b>\n<b>Account:</b> &lt;script&gt;&amp; &quot;hello&quot;",
  );
  const bangla = renderMessage(
    "⚡ DESCO status\nBalance: ৳450.00\nMeter reading: 2026-10-04 00:00:00 Dhaka",
    "bn",
  );
  assert.match(bangla, /<b>⚡ ডেসকো হিসাব<\/b>/);
  assert.match(bangla, /<b>ব্যালেন্স:<\/b>/);
  assert.match(bangla, /মিটারের রিডিং:/);
  assert.match(
    renderMessage(
      "⚡ Zeus DescoBuddy\n/connect ACCOUNT_NUMBER METER_NUMBER",
      "bn",
    ),
    /\/connect ACCOUNT_NUMBER METER_NUMBER/,
  );
  assert.match(
    renderMessage(
      "Extra balance alert removed. Default ৳500/৳300/৳200 alerts stay enabled.",
      "bn",
    ),
    /বাড়তি ব্যালেন্স সতর্কতা সরানো হয়েছে/,
  );
});
