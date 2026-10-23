import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { renderChart } from "../src/chart.js";
import {
  automaticGraphs,
  graphMessage,
  lastCompletedMonth,
  lastCompletedWeek,
} from "../src/graphs.js";
import { shift } from "../src/finance.js";

function rows(start, end) {
  const result = [];
  let units = 100,
    cost = 0;
  for (let day = shift(start, -1); day <= end; day = shift(day, 1)) {
    if (day === start) cost = 0;
    units += 3;
    cost += 25;
    result.push({
      date: day,
      meterNo: "M",
      consumedUnit: units,
      consumedTaka: cost,
    });
  }
  return result;
}

test("weekly and monthly boundaries follow Bangladesh calendar", () => {
  const sunday = Date.parse("2026-10-24T20:00:00Z"); // 25 Oct 02:00 Dhaka
  assert.deepEqual(lastCompletedWeek(sunday), {
    start: "2026-10-18",
    end: "2026-10-24",
  });
  assert.deepEqual(lastCompletedMonth(sunday), {
    start: "2026-09-01",
    end: "2026-09-30",
  });
});

test("automatic week graph waits for all official days and queues once", async () => {
  const now = Date.parse("2026-10-24T20:00:00Z"),
    daily = rows("2026-10-18", "2026-10-24"),
    state = {
      profile: { account: "123", meter: "M" },
      cache: { daily: { data: daily.slice(0, -1) } },
      autoGraphs: { weekEnd: "2026-10-17", monthEnd: "2026-09-30" },
    };
  let calls = 0;
  const fetchDaily = async () => {
    calls++;
    return calls === 1 ? daily.slice(0, -1) : daily;
  };
  assert.deepEqual(await automaticGraphs(state, now, fetchDaily), []);
  assert.equal(calls, 1);
  assert.deepEqual(await automaticGraphs(state, now + 1000, fetchDaily), []);
  assert.equal(calls, 1);
  const result = await automaticGraphs(
    state,
    now + 6 * 3600000 + 1,
    fetchDaily,
  );
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].graph.rows.length, 7);
  assert.equal(
    result[0].graph.rows.every(
      (row) => !row.estimated && row.cost != null && row.units != null,
    ),
    true,
  );
  assert.equal(state.autoGraphs.weekEnd, "2026-10-24");
  assert.deepEqual(
    await automaticGraphs(state, now + 6 * 3600000 + 2, fetchDaily),
    [],
  );
});

test("month graph fetches the previous full month, including its opening baseline", async () => {
  const now = Date.parse("2026-10-31T20:00:00Z"),
    state = {
      profile: { account: "123", meter: "M" },
      cache: { daily: { data: [] } },
      autoGraphs: { weekEnd: "2026-10-31", monthEnd: "2026-09-30" },
    };
  const requests = [];
  const result = await automaticGraphs(
    state,
    now,
    async (_profile, start, end) => {
      requests.push([start, end]);
      return rows("2026-10-01", "2026-10-31");
    },
  );
  assert.deepEqual(requests, [["2026-09-30", "2026-10-31"]]);
  assert.equal(result.length, 1);
  assert.equal(result[0].graph.kind, "month");
  assert.equal(result[0].graph.rows.length, 31);
  assert.equal(state.autoGraphs.monthEnd, "2026-10-31");
});

test("on-demand graph keeps estimated cost but never invents kWh", () => {
  const state = {
    profile: { meter: "M" },
    cache: { daily: { data: rows("2026-10-05", "2026-10-10") } },
    readingSeen: { estimates: { "2026-10-11": "284.56" } },
  };
  const message = graphMessage(state, "week", "2026-10-05", "2026-10-11");
  const last = message.graph.rows.at(-1);
  assert.equal(last.cost, "284.56");
  assert.equal(last.units, null);
  assert.equal(last.estimated, true);
  assert.match(message.text, /Probable cost days: 1/);
});

test("graph renderer produces a valid bounded PNG", () => {
  const spec = {
    kind: "week",
    start: "2026-10-05",
    end: "2026-10-11",
    rows: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-10-${String(i + 5).padStart(2, "0")}`,
      cost: i === 6 ? "284.56" : String(250 + i),
      units: i === 6 ? null : String(29 + i / 10),
      estimated: i === 6,
    })),
  };
  const png = renderChart(spec);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(new DataView(png.buffer).getUint32(16), 760);
  assert.equal(new DataView(png.buffer).getUint32(20), 900);
  assert.ok(png.length < 1000000);
  let offset = 8,
    idat,
    palette;
  while (offset < png.length) {
    const length = new DataView(png.buffer).getUint32(offset),
      type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
    if (type === "PLTE") palette = png.slice(offset + 8, offset + 8 + length);
    if (type === "IDAT") {
      idat = png.slice(offset + 8, offset + 8 + length);
      break;
    }
    offset += 12 + length;
  }
  assert.ok(palette.length <= 256 * 3);
  assert.deepEqual([...palette.slice(0, 3)], [20, 27, 58]);
  assert.deepEqual([...palette.slice(12, 15)], [255, 197, 51]);
  assert.deepEqual([...palette.slice(18, 21)], [238, 241, 249]);
  const raw = inflateSync(idat);
  assert.equal(raw.length, 900 * 761);
  assert.ok(new Set(raw).size > 20, "real-font edges should be antialiased");
});
