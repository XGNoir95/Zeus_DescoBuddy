import * as source from "./desco.js";
import { dailyDeltas, dhakaDate, shift, usageSeries } from "./finance.js";

export function lastCompletedWeek(now = Date.now()) {
  const today = dhakaDate(now),
    weekday = new Date(`${today}T00:00:00Z`).getUTCDay(),
    offset = (weekday + 1) % 7 || 7,
    end = shift(today, -offset);
  return { start: shift(end, -6), end };
}
export function lastCompletedMonth(now = Date.now()) {
  const end = shift(`${dhakaDate(now).slice(0, 7)}-01`, -1);
  return { start: `${end.slice(0, 7)}-01`, end };
}
export function graphMessage(
  state,
  kind,
  start,
  end,
  daily = state.cache?.daily?.data,
) {
  const rows = usageSeries(state, start, end, daily),
    confirmed = rows.filter(
      (row) => row.units != null && row.cost != null && !row.estimated,
    ).length,
    probable = rows.filter((row) => row.estimated).length,
    pending = rows.filter((row) => row.cost == null).length;
  return {
    graph: { kind, start, end, rows },
    text: [
      `📈 ${kind === "week" ? "Week" : "Month"} graph: ${start} → ${end}`,
      `DESCO-complete days: ${confirmed}/${rows.length}`,
      `Probable cost days: ${probable} · Pending cost days: ${pending}`,
      "Amber cost is an unofficial probable balance deduction. No kWh is guessed.",
    ].join("\n"),
  };
}
function completeOfficial(daily, start, end) {
  const rows = new Map(dailyDeltas(daily).map((row) => [row.date, row]));
  for (let d = start; d <= end; d = shift(d, 1))
    if (rows.get(d)?.units == null || rows.get(d)?.cost == null) return false;
  return true;
}
export async function automaticGraphs(
  state,
  now = Date.now(),
  fetchDaily = source.daily,
) {
  const week = lastCompletedWeek(now),
    month = lastCompletedMonth(now);
  if (!state.autoGraphs) {
    // Do not surprise existing or newly connected users with old-period graphs.
    state.autoGraphs = { weekEnd: week.end, monthEnd: month.end };
    return [];
  }
  if (state.paused) {
    state.autoGraphs.weekEnd = week.end;
    state.autoGraphs.monthEnd = month.end;
    return [];
  }
  const messages = [];
  for (const [kind, latestEnd] of [
    ["week", week.end],
    ["month", month.end],
  ]) {
    const key = kind === "week" ? "weekEnd" : "monthEnd",
      previousEnd = state.autoGraphs[key];
    if (!previousEnd) continue;
    const start = shift(previousEnd, 1),
      nextMonthStart =
        kind === "month"
          ? new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7), 1))
              .toISOString()
              .slice(0, 10)
          : null,
      periodEnd =
        kind === "week" ? shift(previousEnd, 7) : shift(nextMonthStart, -1);
    if (periodEnd > latestEnd) continue;
    let daily = state.cache?.daily?.data || [];
    if (!completeOfficial(daily, start, periodEnd)) {
      const retryKey = kind === "week" ? "nextWeekTry" : "nextMonthTry";
      if (now < (state.autoGraphs[retryKey] || 0)) continue;
      state.autoGraphs[retryKey] = now + 6 * 3600000;
      try {
        daily = await fetchDaily(state.profile, shift(start, -1), periodEnd);
      } catch {
        continue;
      }
    }
    if (!completeOfficial(daily, start, periodEnd)) continue;
    messages.push({
      ...graphMessage(state, kind, start, periodEnd, daily),
      event: `auto-graph:${kind}:${start}:${periodEnd}`,
    });
    state.autoGraphs[key] = periodEnd;
  }
  return messages;
}
