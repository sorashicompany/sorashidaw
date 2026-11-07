export type CollaborationOperation =
  | {
      kind: "entity.patch";
      opId: string;
      roomId: string;
      actorId: number;
      entity: "track" | "note" | "synth" | "mixer" | "project";
      entityId: string;
      patch: Record<string, unknown>;
      clientTime: number;
    }
  | {
      kind: "entity.create";
      opId: string;
      roomId: string;
      actorId: number;
      entity: "track" | "note";
      entityId: string;
      value: Record<string, unknown>;
      clientTime: number;
    }
  | {
      kind: "entity.delete";
      opId: string;
      roomId: string;
      actorId: number;
      entity: "track" | "note";
      entityId: string;
      clientTime: number;
    };

export type CollaborationEnvelope =
  | {
      type: "sync.operation";
      sequence: number;
      operation: CollaborationOperation;
    }
  | {
      type: "sync.presence";
      sequence: number;
      actorId: number;
      status: "joined" | "left";
    }
  | {
      type: "sync.ack";
      opId: string;
      sequence: number;
    }
  | {
      type: "sync.error";
      opId?: string;
      message: string;
    };

export function isCollaborationOperation(value: unknown): value is CollaborationOperation {
  if (!value || typeof value !== "object") return false;
  const op = value as Partial<CollaborationOperation>;
  return (
    (op.kind === "entity.patch" || op.kind === "entity.create" || op.kind === "entity.delete") &&
    typeof op.opId === "string" &&
    typeof op.roomId === "string" &&
    typeof op.actorId === "number" &&
    typeof op.entity === "string" &&
    typeof op.entityId === "string" &&
    typeof op.clientTime === "number"
  );
}
