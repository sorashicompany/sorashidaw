import { DurableObject } from "cloudflare:workers";
import type {
  CollaborationEnvelope,
  CollaborationOperation,
} from "../../../packages/shared/src/collaboration";

export interface RoomEnv {
  BEAT_ROOM: DurableObjectNamespace<BeatRoom>;
}

type Connection = {
  actorId: number;
  roomId: string;
};

export class BeatRoom extends DurableObject<RoomEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const roomId = request.headers.get("X-Beat-Room-Id");
    const actorId = Number(request.headers.get("X-Telegram-User-Id"));

    if (!roomId || !Number.isSafeInteger(actorId) || actorId <= 0) {
      return new Response("Missing verified room identity", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ actorId, roomId } satisfies Connection);

    this.broadcast({
      type: "sync.presence",
      sequence: 0,
      actorId,
      status: "joined",
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const connection = ws.deserializeAttachment() as Connection;
    if (typeof message !== "string") {
      ws.send(JSON.stringify({ type: "sync.error", message: "Binary messages are not supported" }));
      return;
    }

    let operation: CollaborationOperation;
    try {
      operation = JSON.parse(message) as CollaborationOperation;
    } catch {
      ws.send(JSON.stringify({ type: "sync.error", message: "Invalid collaboration operation" }));
      return;
    }

    if (
      !operation ||
      operation.roomId !== connection.roomId ||
      operation.actorId !== connection.actorId ||
      typeof operation.opId !== "string"
    ) {
      ws.send(JSON.stringify({ type: "sync.error", opId: operation?.opId, message: "Invalid operation identity" }));
      return;
    }

    // There is deliberately no lock, lease, ownership, or editor check.
    // Every verified room participant can submit operations for every entity.
    const sequence = await this.nextSequence();

    const envelope: CollaborationEnvelope = {
      type: "sync.operation",
      sequence,
      operation,
    };

    this.broadcast(envelope);
    ws.send(JSON.stringify({ type: "sync.ack", opId: operation.opId, sequence }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    const connection = ws.deserializeAttachment() as Connection | null;
    if (connection) {
      this.broadcast({
        type: "sync.presence",
        sequence: 0,
        actorId: connection.actorId,
        status: "left",
      });
    }
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("BeatRoom WebSocket error", error);
  }

  private async nextSequence(): Promise<number> {
    const current = (await this.ctx.storage.get<number>("sequence")) ?? 0;
    const next = current + 1;
    await this.ctx.storage.put("sequence", next);
    return next;
  }

  private broadcast(message: CollaborationEnvelope): void {
    const payload = JSON.stringify(message);
    for (const client of this.ctx.getWebSockets()) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
