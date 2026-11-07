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

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  message: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", cryptoKey, encodeUtf8(message));
}

async function deriveTelegramSecret(botToken: string): Promise<ArrayBuffer> {
  return hmacSha256(encodeUtf8("WebAppData"), botToken);
}

function buildDataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): Promise<TelegramInitData> {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) {
    throw new Error("Telegram init data is missing hash");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) {
    throw new Error("Telegram init data is missing auth_date");
  }

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < 0 || age > maxAgeSeconds) {
    throw new Error("Telegram init data has expired");
  }

  const secret = await deriveTelegramSecret(botToken);
  const dataCheckString = buildDataCheckString(params);
  const calculatedHash = toHex(await hmacSha256(secret, dataCheckString));

  if (!timingSafeEqualHex(calculatedHash, receivedHash)) {
    throw new Error("Telegram init data signature is invalid");
  }

  return {
    user: parseJsonParam<TelegramWebAppUser>(params, "user"),
    chat: parseJsonParam<TelegramInitData["chat"]>(params, "chat"),
    chat_type: params.get("chat_type") ?? undefined,
    auth_date: authDate,
    query_id: params.get("query_id") ?? undefined,
    start_param: params.get("start_param") ?? undefined,
  };
}

function parseJsonParam<T>(params: URLSearchParams, key: string): T | undefined {
  const value = params.get(key);
  if (!value) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Telegram init data contains invalid ${key}`);
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}
