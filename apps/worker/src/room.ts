import { DurableObject } from "cloudflare:workers";
import type { CollaborationEnvelope, CollaborationOperation, PresenceState } from "../../../packages/shared/src/collaboration";

export interface RoomEnv { BEAT_ROOM: DurableObjectNamespace<BeatRoom>; }
type Connection = { actorId: number; roomId: string; presence: PresenceState };
const MAX_RECENT_OPERATIONS = 500;

export class BeatRoom extends DurableObject<RoomEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const roomId = request.headers.get("X-Beat-Room-Id");
    const actorId = Number(request.headers.get("X-Telegram-User-Id"));
    const username = request.headers.get("X-Telegram-Username") || undefined;
    const firstName = request.headers.get("X-Telegram-First-Name") || "Telegram user";
    const avatarUrl = request.headers.get("X-Telegram-Avatar-Url") || undefined;
    if (!roomId || !Number.isSafeInteger(actorId) || actorId <= 0) return new Response("Missing verified room identity", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const presence: PresenceState = { actorId, username, firstName, avatarUrl, status: "online", area: "Beat Studio", cursor: null };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ actorId, roomId, presence } satisfies Connection);

    const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
    if (Number.isSafeInteger(since) && since >= 0) {
      const operations = await this.readOperationsAfter(since);
      const sequence = (await this.ctx.storage.get<number>("sequence")) ?? 0;
      if (operations.length > 0) server.send(JSON.stringify({ type: "sync.snapshot", sequence, operations } satisfies CollaborationEnvelope));
    }

    const current = this.currentPresence();
    server.send(JSON.stringify({ type: "sync.clock", serverTimeMs: Date.now() } satisfies CollaborationEnvelope));
    server.send(JSON.stringify({ type: "sync.presence.snapshot", sequence: 0, presence: current } satisfies CollaborationEnvelope));
    this.broadcast({ type: "sync.presence", sequence: 0, presence } satisfies CollaborationEnvelope, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const connection = ws.deserializeAttachment() as Connection;
    if (typeof message !== "string") { ws.send(JSON.stringify({ type: "sync.error", message: "Binary messages are not supported" })); return; }

    let value: unknown;
    try { value = JSON.parse(message); } catch { ws.send(JSON.stringify({ type: "sync.error", message: "Invalid JSON" })); return; }

    if (isPresenceMessage(value)) {
      const next: PresenceState = { ...connection.presence, ...value.presence, actorId: connection.actorId, status: "online" };
      connection.presence = next;
      ws.serializeAttachment(connection);
      this.broadcast({ type: "sync.presence", sequence: 0, presence: next } satisfies CollaborationEnvelope);
      return;
    }

    if (isCursorMessage(value)) {
      this.broadcast({ type: "sync.cursor", actorId: connection.actorId, cursor: value.cursor, area: value.area } satisfies CollaborationEnvelope, ws);
      return;
    }

    const operation = value as CollaborationOperation;
    if (!operation || operation.roomId !== connection.roomId || operation.actorId !== connection.actorId || typeof operation.opId !== "string") {
      ws.send(JSON.stringify({ type: "sync.error", opId: operation?.opId, message: "Invalid operation identity" }));
      return;
    }

    const sequence = await this.nextSequence();
    const envelope: CollaborationEnvelope = { type: "sync.operation", sequence, operation };
    this.broadcast(envelope);
    await this.appendOperation(sequence, operation);
    ws.send(JSON.stringify({ type: "sync.ack", opId: operation.opId, sequence } satisfies CollaborationEnvelope));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const connection = ws.deserializeAttachment() as Connection | null;
    if (connection) {
      this.broadcast({ type: "sync.presence", sequence: 0, presence: { ...connection.presence, status: "offline", cursor: null } } satisfies CollaborationEnvelope, ws);
    }
    ws.close(code, reason);
  }
  async webSocketError(ws: WebSocket, error: unknown) { console.error("BeatRoom WebSocket error", error); }

  async webSocketFetch(request: Request) { return this.fetch(request); }

  private currentPresence(): PresenceState[] {
    return this.ctx.getWebSockets().map(ws => (ws.deserializeAttachment() as Connection).presence);
  }
  private async nextSequence() { const current = (await this.ctx.storage.get<number>("sequence")) ?? 0; const next = current + 1; await this.ctx.storage.put("sequence", next); return next; }
  private async appendOperation(sequence: number, operation: CollaborationOperation) {
    const log = (await this.ctx.storage.get<Array<{ sequence: number; operation: CollaborationOperation }>>("operations")) ?? [];
    log.push({ sequence, operation }); await this.ctx.storage.put("operations", log.slice(-MAX_RECENT_OPERATIONS));
  }
  private async readOperationsAfter(sequence: number) {
    const log = (await this.ctx.storage.get<Array<{ sequence: number; operation: CollaborationOperation }>>("operations")) ?? [];
    return log.filter(x => x.sequence > sequence).map(x => x.operation);
  }
  private broadcast(message: CollaborationEnvelope, exclude?: WebSocket) {
    const payload = JSON.stringify(message);
    for (const client of this.ctx.getWebSockets()) if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function isPresenceMessage(value: unknown): value is { type: "presence.update"; presence: Partial<PresenceState> } {
  return !!value && typeof value === "object" && (value as { type?: string }).type === "presence.update";
}
function isCursorMessage(value: unknown): value is { type: "cursor.move"; cursor: { x: number; y: number }; area: string } {
  if (!value || typeof value !== "object" || (value as { type?: string }).type !== "cursor.move") return false;
  const cursor = (value as { cursor?: { x?: number; y?: number } }).cursor;
  return !!cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) && typeof (value as { area?: string }).area === "string";
}
