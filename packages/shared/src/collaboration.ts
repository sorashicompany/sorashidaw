export type CollaborationOperationType =
  | "ADD_TRACK"
  | "UPDATE_TRACK"
  | "DELETE_TRACK"
  | "ADD_NOTE"
  | "MOVE_NOTE"
  | "DELETE_NOTE"
  | "CHANGE_VELOCITY"
  | "ADD_SAMPLE"
  | "DELETE_SAMPLE"
  | "SET_VOLUME"
  | "SET_PAN"
  | "SET_FILTER"
  | "ADD_EFFECT"
  | "REMOVE_EFFECT"
  | "MOVE_CLIP"
  | "DELETE_CLIP"
  | "CHANGE_BPM"
  | "CHANGE_PATTERN"
  | "SET_SYNTH_PARAMETER"
  | "SET_AUTOMATION";

export type CollaborationOperation =
  | {
      type: CollaborationOperationType;
      opId: string;
      roomId: string;
      actorId: number;
      targetId: string;
      trackId?: string;
      payload: Record<string, unknown>;
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
      sequence: 0;
      actorId: number;
      status: "joined" | "left";
    }
  | {
      type: "sync.ack";
      opId: string;
      sequence: number;
    }
  | {
      type: "sync.snapshot";
      sequence: number;
      operations: CollaborationOperation[];
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
    typeof op.type === "string" &&
    typeof op.opId === "string" &&
    typeof op.roomId === "string" &&
    typeof op.actorId === "number" &&
    typeof op.targetId === "string" &&
    typeof op.payload === "object" &&
    op.payload !== null &&
    typeof op.clientTime === "number"
  );
}
