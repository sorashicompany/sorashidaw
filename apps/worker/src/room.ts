import { DurableObject } from "cloudflare:workers";
import type { CollaborationEnvelope, CollaborationOperation, PresenceState } from "../../../packages/shared/src/collaboration";

export interface RoomEnv { BEAT_ROOM: DurableObjectNamespace<BeatRoom>; }
type Connection = { actorId: number; roomId: string; presence: PresenceState };
const MAX_RECENT_OPERATIONS = 500;
const MAX_OPERATION_PAYLOAD_BYTES = 128 * 1024;
const MAX_PROJECT_VERSIONS = 50;
const HISTORY_MIN_INTERVAL_MS = 5000;
type ProjectVersion = { version: number; label: string; createdAt: string; state: unknown; hash: string };

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

  async getProjectState(): Promise<{ state: unknown; version: number; updatedAt: string | null }> {
    const state = await this.ctx.storage.get<unknown>("project-state");
    const version = (await this.ctx.storage.get<number>("project-version")) ?? 0;
    const updatedAt = (await this.ctx.storage.get<string>("project-updated-at")) ?? null;
    return { state: state ?? null, version, updatedAt };
  }

  async saveProjectState(state: unknown, clientVersion?: number, forceHistory = false): Promise<{ version: number; updatedAt: string; historyVersion: number | null }> {
    const current = (await this.ctx.storage.get<number>("project-version")) ?? 0;
    const version = Math.max(current + 1, Number(clientVersion ?? 0));
    const updatedAt = new Date().toISOString();
    const hash = await this.hashState(state);
    const historyIndex = (await this.ctx.storage.get<Array<{ version: number; label: string; createdAt: string; hash: string }>>("project-history-index")) ?? [];
    const last = historyIndex[historyIndex.length - 1];
    const shouldVersion = forceHistory || !last || (last.hash !== hash && Date.parse(updatedAt) - Date.parse(last.createdAt) >= HISTORY_MIN_INTERVAL_MS);
    let historyVersion: number | null = last?.version ?? null;
    await this.ctx.storage.put("project-state", state);
    await this.ctx.storage.put("project-version", version);
    await this.ctx.storage.put("project-updated-at", updatedAt);
    if (shouldVersion) {
      historyVersion = (last?.version ?? 0) + 1;
      const record: ProjectVersion = { version: historyVersion, label: "Beat v" + historyVersion, createdAt: updatedAt, state: structuredClone(state), hash };
      const nextIndex = [...historyIndex, { version: record.version, label: record.label, createdAt: record.createdAt, hash: record.hash }];
      const stale = nextIndex.slice(0, -MAX_PROJECT_VERSIONS);
      for (const item of stale) await this.ctx.storage.delete("project-history:" + item.version);
      await this.ctx.storage.put("project-history:" + record.version, record);
      await this.ctx.storage.put("project-history-index", nextIndex.slice(-MAX_PROJECT_VERSIONS));
    }
    return { version, updatedAt, historyVersion };
  }

  async getProjectHistory(): Promise<Array<{ version: number; label: string; createdAt: string }>> {
    const index = (await this.ctx.storage.get<Array<{ version: number; label: string; createdAt: string; hash: string }>>("project-history-index")) ?? [];
    return index.map(({ hash: _hash, ...meta }) => meta);
  }

  async restoreProjectVersion(version: number): Promise<{ version: number; restoredFrom: number; updatedAt: string }> {
    const target = await this.ctx.storage.get<ProjectVersion>("project-history:" + version);
    if (!target) throw new Error("Project version not found");
    const restored = await this.saveProjectState(structuredClone(target.state), undefined, true);
    const updatedAt = new Date().toISOString();
    return { version: restored.historyVersion ?? version, restoredFrom: version, updatedAt };
  }

  private async hashState(state: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
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
    if (JSON.stringify(operation).length > MAX_OPERATION_PAYLOAD_BYTES) {
      ws.send(JSON.stringify({ type: "sync.error", opId: operation?.opId, message: "Operation payload too large" }));
      return;
    }
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
