const encoder = new TextEncoder();

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export type SupabaseRoomPayload = {
  first_name?: string;
  username?: string;
  last_name?: string;
  chat_type?: string;
  chat_title?: string;
  chat_username?: string;
  state?: unknown;
  version?: number;
  label?: string;
};

export async function supabaseWorkerCall<T>(
  env: { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string; SUPABASE_WORKER_SIGNING_SECRET: string },
  action: string,
  chatId: number,
  userId: number,
  payload: SupabaseRoomPayload,
): Promise<T> {
  const payloadJson = stableJson(payload);
  const message = action + ":" + chatId + ":" + userId + ":" + payloadJson;
  const signature = await hmacHex(env.SUPABASE_WORKER_SIGNING_SECRET, message);
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/worker_sync_room", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: "Bearer " + env.SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      p_action: action,
      p_chat_id: chatId,
      p_user_id: userId,
      p_payload: payload,
      p_signature: signature,
    }),
  });
  if (!response.ok) throw new Error("Supabase RPC failed: " + response.status + " " + await response.text());
  return await response.json() as T;
}
