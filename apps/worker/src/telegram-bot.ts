export type TelegramBotConfig = {
  token: string;
  miniAppUrl: string;
  botUsername?: string;
};

type InlineKeyboardButton = { text: string; web_app?: { url: string }; url?: string };
type ReplyKeyboardButton = { text: string; web_app?: { url: string } };

async function telegramApi<T>(token: string, method: string, body: unknown): Promise<T> {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !data.ok) throw new Error(data.description ?? "Telegram Bot API request failed");
  return data.result as T;
}

export function openBeatStudioKeyboard(miniAppUrl: string): { inline_keyboard: InlineKeyboardButton[][] } {
  return { inline_keyboard: [[{ text: "Open Beat Studio", web_app: { url: miniAppUrl } }]] };
}

export async function sendOpenBeatStudio(token: string, chatId: number, miniAppUrl: string, text = "Open the shared Beat Studio for this chat."): Promise<void> {
  await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: openBeatStudioKeyboard(miniAppUrl),
  });
}

export async function sendInvite(token: string, chatId: number, miniAppUrl: string, inviteUrl?: string): Promise<void> {
  const text = inviteUrl
    ? "Invite participants to this Telegram chat:\n" + inviteUrl + "\n\nThen use Open Beat Studio."
    : "Open Beat Studio from this chat to join the shared Beat Room.";
  await sendOpenBeatStudio(token, chatId, miniAppUrl, text);
}

export async function sendBeatSaved(token: string, chatId: number, miniAppUrl: string, version?: number): Promise<void> {
  const suffix = version ? " Version " + version + " is saved." : " The latest project state is saved.";
  await sendOpenBeatStudio(token, chatId, miniAppUrl, "Beat saved." + suffix);
}

export async function sendExportedFile(token: string, chatId: number, file: File, caption = "Beat export"): Promise<void> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("document", file, file.name);
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendDocument", { method: "POST", body: form });
  const data = await response.json() as { ok: boolean; description?: string };
  if (!response.ok || !data.ok) throw new Error(data.description ?? "Telegram export delivery failed");
}

export async function getGroupInviteLink(token: string, chatId: number): Promise<string> {
  return telegramApi<string>(token, "exportChatInviteLink", { chat_id: chatId });
}

export async function setBotWebhook(token: string, webhookUrl: string, secretToken?: string): Promise<void> {
  await telegramApi(token, "setWebhook", {
    url: webhookUrl,
    ...(secretToken ? { secret_token: secretToken } : {}),
    allowed_updates: ["message", "callback_query"],
  });
}
