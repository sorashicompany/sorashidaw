export type CollaborationOperationType =
  | "ADD_TRACK" | "UPDATE_TRACK" | "DELETE_TRACK" | "ADD_NOTE" | "MOVE_NOTE"
  | "DELETE_NOTE" | "CHANGE_VELOCITY" | "ADD_SAMPLE" | "DELETE_SAMPLE"
  | "SET_VOLUME" | "SET_PAN" | "SET_FILTER" | "ADD_EFFECT" | "REMOVE_EFFECT"
  | "MOVE_CLIP" | "RESIZE_CLIP" | "SPLIT_CLIP" | "DELETE_CLIP" | "DUPLICATE_CLIP"
  | "COPY_CLIP" | "PASTE_CLIP" | "CHANGE_BPM" | "TRANSPORT_SET" | "CHANGE_PATTERN" | "ADD_AUDIO_CLIP"
  | "ADD_MIDI_CLIP" | "ADD_PATTERN_CLIP" | "ADD_LOOP_CLIP" | "SET_CLIP_CONTENT"
  | "SET_AUTOMATION" | "ADD_MARKER" | "UPDATE_MARKER" | "DELETE_MARKER"
  | "ADD_GROUP" | "UPDATE_GROUP" | "DELETE_GROUP" | "SET_GRID" | "SET_ZOOM"
  | "SET_SYNTH_PARAMETER" | "SET_EFFECT_PARAMETER" | "SET_MIXER_PARAMETER" | "ADD_MIXER_CHANNEL" | "SET_MIDI_CC" | "MIDI_NOTE_ON" | "MIDI_NOTE_OFF" | "UPDATE_DRUM_CHANNEL" | "ADD_DRUM_SAMPLE";

export type CollaborationOperation = {
  type: CollaborationOperationType;
  opId: string;
  roomId: string;
  actorId: number;
  targetId: string;
  trackId?: string;
  payload: Record<string, unknown>;
  clientTime: number;
};

export type PresenceState = {
  actorId: number;
  username?: string;
  firstName: string;
  avatarUrl?: string;
  status: "online" | "offline";
  area: string;
  cursor: { x: number; y: number } | null;
};

export type CollaborationEnvelope =
  | { type: "sync.operation"; sequence: number; operation: CollaborationOperation }
  | { type: "sync.presence"; sequence: 0; presence: PresenceState }
  | { type: "sync.presence.snapshot"; sequence: 0; presence: PresenceState[] }
  | { type: "sync.cursor"; actorId: number; cursor: { x: number; y: number }; area: string }
  | { type: "sync.ack"; opId: string; sequence: number }
  | { type: "sync.snapshot"; sequence: number; operations: CollaborationOperation[] }
  | { type: "sync.error"; opId?: string; message: string }
  | { type: "sync.clock"; serverTimeMs: number };

export function isCollaborationOperation(value: unknown): value is CollaborationOperation {
  if (!value || typeof value !== "object") return false;
  const op = value as Partial<CollaborationOperation>;
  return typeof op.type === "string" && typeof op.opId === "string" &&
    typeof op.roomId === "string" && typeof op.actorId === "number" &&
    typeof op.targetId === "string" && typeof op.payload === "object" &&
    op.payload !== null && typeof op.clientTime === "number";
}
