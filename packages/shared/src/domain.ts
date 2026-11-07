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

export type CollaborationEvent =
  | {
      type: "track.created";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: {
        trackId: string;
        name: string;
      };
    }
  | {
      type: "track.updated";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: {
        trackId: string;
        patch: Record<string, unknown>;
      };
    }
  | {
      type: "note.changed";
      eventId: string;
      roomId: BeatRoomId;
      actorId: number;
      payload: {
        trackId: string;
        noteId: string;
        patch: Record<string, unknown>;
      };
    };
