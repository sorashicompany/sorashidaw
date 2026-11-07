export interface Env {
  TELEGRAM_BOT_TOKEN: string;
}

import { verifyTelegramInitData } from "./telegram";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "sorashidaw-api" });
    }

    if (url.pathname === "/api/auth/telegram" && request.method === "POST") {
      return authenticateTelegram(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function authenticateTelegram(request: Request, env: Env): Promise<Response> {
  let body: { initData?: string };

  try {
    body = (await request.json()) as { initData?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.initData) {
    return Response.json({ error: "initData is required" }, { status: 400 });
  }

  try {
    const data = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);

    if (!data.user || !data.chat) {
      return Response.json(
        { error: "Verified Telegram user/chat context is missing" },
        { status: 401 },
      );
    }

    return Response.json({
      authenticated: true,
      user: data.user,
      chat: {
        id: data.chat.id,
        type: data.chat.type ?? data.chat_type,
        title: data.chat.title,
        username: data.chat.username,
      },
    });
  } catch {
    return Response.json({ error: "Telegram authentication failed" }, { status: 401 });
  }
}
