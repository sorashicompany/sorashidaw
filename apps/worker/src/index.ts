import { verifyTelegramInitData } from "./telegram";
import { BeatRoom } from "./room";
import { createRoomTicket, verifyRoomTicket } from "./room-ticket";

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  BEAT_ROOM: DurableObjectNamespace<BeatRoom>;
}

type AuthResponse = {
  authenticated: true;
  roomTicket: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type?: string;
    title?: string;
    username?: string;
  };
};

export { BeatRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/auth/telegram") {
      return authenticateTelegram(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/room/socket") {
      return connectRoomSocket(request, env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "sorashidaw-api" });
    }

    return json({ error: "Not found" }, 404);
  },
};

async function authenticateTelegram(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: { initData?: string };

  try {
    body = (await request.json()) as { initData?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.initData) return json({ error: "initData is required" }, 400);

  try {
    const data = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);

    if (!data.user) return json({ error: "Telegram user is missing" }, 401);
    if (!data.chat) return json({ error: "Telegram chat context is missing" }, 401);

    const roomTicket = await createRoomTicket(
      data.user.id,
      data.chat.id,
      env.TELEGRAM_BOT_TOKEN,
    );

    const response: AuthResponse = {
      authenticated: true,
      roomTicket,
      user: {
        id: data.user.id,
        first_name: data.user.first_name,
        last_name: data.user.last_name,
        username: data.user.username,
      },
      chat: {
        id: data.chat.id,
        type: data.chat.type ?? data.chat_type,
        title: data.chat.title,
        username: data.chat.username,
      },
    };

    return json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram authentication failed";
    return json({ error: message }, 401);
  }
}

async function connectRoomSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return json({ error: "WebSocket upgrade required" }, 426);
  }

  const url = new URL(request.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const ticket = url.searchParams.get("ticket");
  const since = url.searchParams.get("since");

  if (!Number.isSafeInteger(chatId) || !ticket) {
    return json({ error: "chatId and ticket are required" }, 401);
  }

  try {
    const verified = await verifyRoomTicket(ticket, chatId, env.TELEGRAM_BOT_TOKEN);
    const stub = env.BEAT_ROOM.getByName(String(verified.chatId));
    const headers = new Headers(request.headers);
    headers.set("X-Beat-Room-Id", String(verified.chatId));
    headers.set("X-Telegram-User-Id", String(verified.userId));

    const target = new URL(request.url);
    if (since) target.searchParams.set("since", since);

    return stub.fetch(new Request(target, { headers }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Room authentication failed";
    return json({ error: message }, 401);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
