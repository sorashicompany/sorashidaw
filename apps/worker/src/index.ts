import { verifyTelegramInitData } from "./telegram";
import { BeatRoom } from "./room";
import { createRoomTicket, verifyRoomTicket } from "./room-ticket";

export interface Env { TELEGRAM_BOT_TOKEN: string; BEAT_ROOM: DurableObjectNamespace<BeatRoom>; DRUM_KITS: R2Bucket; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/auth/telegram") return authenticateTelegram(request, env);
    if (request.method === "GET" && url.pathname === "/api/room/socket") return connectRoomSocket(request, env);\n    if (url.pathname === "/api/room/assets" && (request.method === "GET" || request.method === "POST")) return roomAssets(request, env);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "sorashidaw-api" });
    return json({ error: "Not found" }, 404);
  },
};
export { BeatRoom };

async function authenticateTelegram(request: Request, env: Env): Promise<Response> {
  let body: { initData?: string };
  try { body = (await request.json()) as { initData?: string }; } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body.initData) return json({ error: "initData is required" }, 400);
  try {
    const data = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
    if (!data.user) return json({ error: "Telegram user is missing" }, 401);
    if (!data.chat) return json({ error: "Telegram chat context is missing" }, 401);
    const roomTicket = await createRoomTicket(data.user.id, data.chat.id, env.TELEGRAM_BOT_TOKEN, { firstName: data.user.first_name, username: data.user.username, avatarUrl: data.user.photo_url });
    return json({
      authenticated: true, roomTicket,
      user: { id: data.user.id, first_name: data.user.first_name, last_name: data.user.last_name, username: data.user.username, photo_url: data.user.photo_url },
      chat: { id: data.chat.id, type: data.chat.type ?? data.chat_type, title: data.chat.title, username: data.chat.username },
    });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Telegram authentication failed" }, 401); }
}

async function connectRoomSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") return json({ error: "WebSocket upgrade required" }, 426);
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId")); const ticket = url.searchParams.get("ticket");
  if (!Number.isSafeInteger(chatId) || !ticket) return json({ error: "chatId and ticket are required" }, 401);
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const stub = env.BEAT_ROOM.getByName(String(verified.chatId));
    const headers = new Headers(request.headers);
    headers.set("X-Beat-Room-Id", String(verified.chatId));
    headers.set("X-Telegram-User-Id", String(verified.userId));
    headers.set("X-Telegram-Username", verified.profile.username ?? "");
    headers.set("X-Telegram-First-Name", verified.profile.firstName);
    headers.set("X-Telegram-Avatar-Url", verified.profile.avatarUrl ?? "");
    const target = new URL(request.url);
    const since = url.searchParams.get("since"); if (since) target.searchParams.set("since", since);
    return stub.fetch(new Request(target, { headers }));
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Room authentication failed" }, 401); }
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }


async function roomAssets(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const ticket = url.searchParams.get("ticket");
  if (!Number.isSafeInteger(chatId) || !ticket) return json({ error: "chatId and ticket are required" }, 401);
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const prefix = String(verified.chatId) + "/";
    if (request.method === "GET") {
      const listed = await env.DRUM_KITS.list({ prefix });
      const assets = listed.objects.map(object => ({
        id: object.key.slice(prefix.length),
        name: object.customMetadata?.name ?? object.key.split("/").pop() ?? "Sample",
        category: object.customMetadata?.category ?? "Other",
        folder: object.customMetadata?.folder ?? "",
        mimeType: object.httpMetadata?.contentType ?? "audio/wav",
        size: object.size,
        previewUrl: "/api/room/assets/" + encodeURIComponent(object.key.slice(prefix.length)) + "?chatId=" + encodeURIComponent(String(chatId)) + "&ticket=" + encodeURIComponent(ticket),
      }));
      return json({ assets });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "WAV file is required" }, 400);
    const category = String(form.get("category") || "Other");
    const folder = String(form.get("folder") || "");
    const name = String(form.get("name") || file.name.replace(/\\.wav$/i, ""));
    const id = crypto.randomUUID();
    const key = prefix + id + ".wav";
    await env.DRUM_KITS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "audio/wav", contentDisposition: "inline" },
      customMetadata: { name, category, folder, mimeType: file.type || "audio/wav", uploadedBy: String(verified.userId) },
    });
    return json({ asset: { id, name, category, folder, mimeType: file.type || "audio/wav", size: file.size } }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Drum kit request failed" }, 401);
  }
}
