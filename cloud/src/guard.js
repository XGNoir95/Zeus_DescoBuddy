const MAX_UPDATE_BYTES = 65536;
const EXPENSIVE_COMMANDS = new Set([
  "connect",
  "usage_history",
  "clear",
  "export",
]);

export class BodyTooLarge extends Error {}

export async function readUpdate(request) {
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > MAX_UPDATE_BYTES)
    throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return "";
  const parts = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPDATE_BYTES) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function isExpensive(update) {
  const text = update.callback_query?.data || update.message?.text || "";
  const name = text.trim().split(/\s+/, 1)[0]?.replace(/^\//, "").split("@")[0];
  return EXPENSIVE_COMMANDS.has(name?.toLowerCase());
}

export async function allowUpdate(env, id, update) {
  // Per-location counters are deliberately advisory. The durable user lease,
  // 3-second command gap, update deduplication and capacity cap remain in place.
  const ordinary = await env.USER_UPDATES.limit({ key: id });
  if (!ordinary.success) return false;
  if (isExpensive(update)) {
    const expensive = await env.EXPENSIVE_UPDATES.limit({ key: id });
    if (!expensive.success) return false;
  }
  return true;
}
