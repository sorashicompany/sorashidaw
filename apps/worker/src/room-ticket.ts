const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createRoomTicket(userId: number, chatId: number, secret: string): Promise<string> {
  const payload = JSON.stringify({ userId, chatId, exp: Math.floor(Date.now() / 1000) + 300 });
  const body = base64Url(encoder.encode(payload));
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(body));
  return body + "." + base64Url(signature);
}

export async function verifyRoomTicket(ticket: string, expectedChatId: number, secret: string): Promise<{ userId: number; chatId: number }> {
  const [body, signature] = ticket.split(".");
  if (!body || !signature) throw new Error("Invalid room ticket");
  const valid = await crypto.subtle.verify("HMAC", await keyFor(secret), fromBase64Url(signature), encoder.encode(body));
  if (!valid) throw new Error("Invalid room ticket signature");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as { userId: number; chatId: number; exp: number };
  if (payload.chatId !== expectedChatId || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Expired or mismatched room ticket");
  return { userId: payload.userId, chatId: payload.chatId };
}