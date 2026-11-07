import { verifyTelegramInitData } from "./telegram";
import { BeatRoom } from "./room";
import { createRoomTicket, verifyRoomTicket } from "./room-ticket";
import { sendBeatSaved, sendExportedFile, sendInvite, sendOpenBeatStudio, getGroupInviteLink } from "./telegram-bot";
import { supabaseWorkerCall } from "./supabase";

export interface Env { TELEGRAM_BOT_TOKEN: string; BEAT_ROOM: DurableObjectNamespace<BeatRoom>; DRUM_KITS: R2Bucket; MINI_APP_URL: string; SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string; SUPABASE_WORKER_SIGNING_SECRET: string; TELEGRAM_WEBHOOK_SECRET?: string; BOT_WEBHOOK_SECRET?: string; BOT_USERNAME?: string; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/auth/telegram") return authenticateTelegram(request, env);
    if (request.method === "GET" && url.pathname === "/api/room/socket") return connectRoomSocket(request, env);
    if (url.pathname === "/api/room/state" && (request.method === "GET" || request.method === "PUT")) return roomState(request, env);
    if (url.pathname === "/api/room/history" && request.method === "GET") return roomHistory(request, env);
    if (url.pathname.startsWith("/api/room/history/") && request.method === "POST") return restoreRoomVersion(request, env);
    if (url.pathname === "/api/room/assets" && (request.method === "GET" || request.method === "POST")) return roomAssets(request, env);
    if (url.pathname.startsWith("/api/room/assets/") && request.method === "GET") return roomAsset(request, env);
    if (request.method === "POST" && url.pathname === "/api/bot/webhook") return botWebhook(request, env);
    if (request.method === "POST" && url.pathname === "/api/bot/export") return botExport(request, env);
    if (request.method === "POST" && url.pathname === "/api/bot/saved") return botSaved(request, env);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "nexoradaw-api" });
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
    await supabaseWorkerCall(env, "load", data.chat.id, data.user.id, { first_name: data.user.first_name, username: data.user.username, last_name: data.user.last_name, chat_type: data.chat.type ?? data.chat_type, chat_title: data.chat.title, chat_username: data.chat.username });
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
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }



async function roomState(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const ticket = url.searchParams.get("ticket");
  if (!Number.isSafeInteger(chatId) || !ticket) return json({ error: "chatId and ticket are required" }, 401);
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const stub = env.BEAT_ROOM.getByName(String(verified.chatId));
    if (request.method === "GET") {
      const remote = await supabaseWorkerCall<{ state: unknown; version: number; updatedAt: string | null }>(env, "load", verified.chatId, verified.userId, {});
      if (remote.state !== null) return json(remote);
      return json(await stub.getProjectState());
    }
    const body = await request.json() as { state?: unknown; version?: number };
    if (!body.state || typeof body.state !== "object") return json({ error: "Project state is required" }, 400);
    const result = await stub.saveProjectState(body.state, body.version);
    await supabaseWorkerCall(env, "save", verified.chatId, verified.userId, { state: body.state, version: result.version });
    if (result.historyVersion !== null) await supabaseWorkerCall(env, "save_version", verified.chatId, verified.userId, { state: body.state, version: result.historyVersion, label: "Beat v" + result.historyVersion });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Project state request failed" }, 401);
  }
}

async function roomHistory(request: Request, env: Env): Promise<Response> {
  const auth = await roomStubFromRequest(request, env);
  if (auth instanceof Response) return auth;
  const verified = await verifyRoomTicket(new URL(request.url).searchParams.get("ticket")!, auth.chatId, env.TELEGRAM_BOT_TOKEN);
  const remote = await supabaseWorkerCall<{ history: Array<{ version: number; label: string; createdAt: string }> }>(env, "history", verified.chatId, verified.userId, {});
  return json(remote.history.length ? remote.history : await auth.stub.getProjectHistory());
}

async function restoreRoomVersion(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const version = Number(url.pathname.slice("/api/room/history/".length));
  if (!Number.isSafeInteger(version) || version < 1) return json({ error: "Invalid version" }, 400);
  const auth = await roomStubFromRequest(request, env);
  if (auth instanceof Response) return auth;
  try {
    const verified = await verifyRoomTicket(new URL(request.url).searchParams.get("ticket")!, auth.chatId, env.TELEGRAM_BOT_TOKEN);
    const remote = await supabaseWorkerCall<{ state: unknown }>(env, "version", verified.chatId, verified.userId, { version });
    const restored = await auth.stub.restoreProjectState(remote.state, version);
    await supabaseWorkerCall(env, "save", verified.chatId, verified.userId, { state: remote.state, version: restored.version });
    await supabaseWorkerCall(env, "save_version", verified.chatId, verified.userId, { state: remote.state, version: restored.version, label: "Beat v" + restored.version });
    return json(restored);
  }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Restore failed" }, 404); }
}

async function roomStubFromRequest(request: Request, env: Env): Promise<{ stub: DurableObjectStub<BeatRoom>; chatId: number } | Response> {
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId")); const ticket = url.searchParams.get("ticket");
  if (!Number.isSafeInteger(chatId) || !ticket) return json({ error: "chatId and ticket are required" }, 401);
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    return { stub: env.BEAT_ROOM.getByName(String(verified.chatId)), chatId: verified.chatId };
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Room authentication failed" }, 401); }
}

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


async function roomAsset(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const ticket = url.searchParams.get("ticket");
  const id = decodeURIComponent(url.pathname.slice("/api/room/assets/".length));
  if (!Number.isSafeInteger(chatId) || !ticket || !id) return new Response("Unauthorized", { status: 401 });
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const object = await env.DRUM_KITS.get(String(verified.chatId) + "/" + id);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=300");
    return new Response(object.body, { headers });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}


async function botWebhook(request: Request, env: Env): Promise<Response> {
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET ?? env.BOT_WEBHOOK_SECRET;
  if (webhookSecret && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) {
    return json({ error: "Invalid webhook secret" }, 401);
  }
  let update: any;
  try { update = await request.json(); } catch { return json({ error: "Invalid update" }, 400); }
  const message = update?.message;
  if (!message?.chat?.id) return json({ ok: true });
  const chatId = Number(message.chat.id);
  const text = String(message.text ?? "").trim();
  if (/^\/(start|open)(?:@[^ ]+)?/i.test(text)) {
    await sendOpenBeatStudio(env.TELEGRAM_BOT_TOKEN, chatId, env.MINI_APP_URL, "This chat has its own shared Beat Room.");
  } else if (/^\/invite(?:@[^ ]+)?/i.test(text)) {
    try {
      const inviteUrl = await getGroupInviteLink(env.TELEGRAM_BOT_TOKEN, chatId);
      await sendInvite(env.TELEGRAM_BOT_TOKEN, chatId, env.MINI_APP_URL, inviteUrl);
    } catch {
      await sendInvite(env.TELEGRAM_BOT_TOKEN, chatId, env.MINI_APP_URL);
    }
  } else if (/^\/beat(?:@[^ ]+)?/i.test(text)) {
    await sendOpenBeatStudio(env.TELEGRAM_BOT_TOKEN, chatId, env.MINI_APP_URL);
  }
  return json({ ok: true });
}

async function botExport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const ticket = url.searchParams.get("ticket");
  if (!Number.isSafeInteger(chatId) || !ticket) return json({ error: "chatId and ticket are required" }, 401);
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Export file is required" }, 400);
    await sendExportedFile(env.TELEGRAM_BOT_TOKEN, verified.chatId, file, String(form.get("caption") || "Beat export"));
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Telegram export failed" }, 400);
  }
}

async function botSaved(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const ticket = url.searchParams.get("ticket");
  if (!Number.isSafeInteger(chatId) || !ticket) return json({ error: "chatId and ticket are required" }, 401);
  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const body = await request.json().catch(() => ({})) as { version?: number };
    await sendBeatSaved(env.TELEGRAM_BOT_TOKEN, verified.chatId, env.MINI_APP_URL, body.version);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Telegram notification failed" }, 400);
  }
}
