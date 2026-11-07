export type BeatRoomId = string;

export type TelegramIdentity = {
  telegramUserId: number;
  telegramChatId: number;
};

export type BeatRoom = {
  id: BeatRoomId;
  telegramChatId: number;
  createdAt: string;
};

/**
 * Room membership proves participation in the shared room.
 * It deliberately contains no role or permission field.
 *
 * Authorization policy:
 * every authenticated room participant may mutate every project element.
 */
export type BeatRoomMember = {
  roomId: BeatRoomId;
  telegramUserId: number;
  lastSeenAt: string;
};

export type CollaborationEvent =
  | {
      type: "track.created";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: { trackId: string; name: string };
    }
  | {
      type: "track.updated";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: { trackId: string; patch: Record<string, unknown> };
    }
  | {
      type: "track.deleted";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: { trackId: string };
    }
  | {
      type: "note.changed";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: { trackId: string; noteId: string; patch: Record<string, unknown> };
    }
  | {
      type: "note.deleted";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: { trackId: string; noteId: string };
    }
  | {
      type: "project.updated";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: { patch: Record<string, unknown> };
    };
