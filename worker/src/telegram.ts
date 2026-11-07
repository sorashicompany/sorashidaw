export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type TelegramInitData = {
  user?: TelegramWebAppUser;
  chat?: {
    id: number;
    type?: string;
    title?: string;
    username?: string;
  };
  chat_type?: string;
  auth_date?: number;
  query_id?: string;
  start_param?: string;
};

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encode(message));
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function parseJson<T>(params: URLSearchParams, key: string): T | undefined {
  const value = params.get(key);
  if (!value) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Invalid Telegram init data payload");
  }
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): Promise<TelegramInitData> {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) throw new Error("Missing Telegram hash");

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) throw new Error("Missing Telegram auth_date");

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < 0 || age > maxAgeSeconds) throw new Error("Expired Telegram init data");

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const secretKey = await hmac(encode("WebAppData"), botToken);
  const calculatedHash = hex(await hmac(secretKey, dataCheckString));

  if (!timingSafeHexEqual(calculatedHash, receivedHash)) {
    throw new Error("Invalid Telegram signature");
  }

  return {
    user: parseJson<TelegramWebAppUser>(params, "user"),
    chat: parseJson<TelegramInitData["chat"]>(params, "chat"),
    chat_type: params.get("chat_type") ?? undefined,
    auth_date: authDate,
    query_id: params.get("query_id") ?? undefined,
    start_param: params.get("start_param") ?? undefined,
  };
}
