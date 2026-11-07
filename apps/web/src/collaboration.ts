import { useEffect, useRef, useState } from "react";
import type { CollaborationEnvelope, CollaborationOperation, CollaborationOperationType } from "../../../packages/shared/src/collaboration";

export type RoomConnectionState = "offline" | "connecting" | "live" | "error";
export type RoomTransportState = {
  playing: boolean;
  bpm: number;
  positionBeats: number;
  startedAtServerMs: number;
  loopEnabled: boolean;
  loopStartBeats: number;
  loopEndBeats: number;
  revision: number;
};

type AuthResponse = {
  authenticated: true;
  roomTicket: string;
  user: { id: number; first_name: string; username?: string; photo_url?: string };
  chat: { id: number };
};

export function useBeatRoom() {
  const socketRef = useRef<WebSocket | null>(null);
  const sequenceRef = useRef(0);
  const [state, setState] = useState<RoomConnectionState>("offline");
  const [events, setEvents] = useState<CollaborationEnvelope[]>([]);
  const [presence, setPresence] = useState<import("../../../packages/shared/src/collaboration").PresenceState[]>([]);
  const identityRef = useRef<{ userId: number; chatId: number } | null>(null);\n  const ticketRef = useRef<string | null>(null);\n  const [roomTicket, setRoomTicket] = useState<string | null>(null);\n  const [chatId, setChatId] = useState<number | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [transport, setTransport] = useState<RoomTransportState | null>(null);

  useEffect(() => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return;

    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;

    async function authenticate() {
      const response = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      if (!response.ok) throw new Error("Telegram authentication failed");
      return (await response.json()) as AuthResponse;
    }

    async function connect() {
      try {
        setState("connecting");
        const auth = await authenticate();
        if (closed) return;
        identityRef.current = { userId: auth.user.id, chatId: auth.chat.id };\n        ticketRef.current = auth.roomTicket;\n        setRoomTicket(auth.roomTicket);\n        setChatId(auth.chat.id);

        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socketUrl = protocol + "//" + location.host + "/api/room/socket"
          + "?chatId=" + encodeURIComponent(String(auth.chat.id))
          + "&ticket=" + encodeURIComponent(auth.roomTicket)
          + "&since=" + encodeURIComponent(String(sequenceRef.current));

        socket = new WebSocket(socketUrl);
        socketRef.current = socket;
        socket.onopen = () => !closed && setState("live");
        socket.onmessage = event => {
          try {
            const message = JSON.parse(event.data) as CollaborationEnvelope;
            if ("sequence" in message && message.sequence > sequenceRef.current) {
              sequenceRef.current = message.sequence;
            }
            if (message.type === "sync.clock") setServerOffsetMs(message.serverTimeMs - Date.now());
            if (message.type === "sync.presence.snapshot") setPresence(message.presence);
            if (message.type === "sync.operation" && message.operation.type === "TRANSPORT_SET") {
              const p = message.operation.payload as Partial<RoomTransportState>;
              setTransport({
                playing: Boolean(p.playing),
                bpm: Number(p.bpm ?? 128),
                positionBeats: Number(p.positionBeats ?? 0),
                startedAtServerMs: Number(p.startedAtServerMs ?? 0),
                loopEnabled: Boolean(p.loopEnabled),
                loopStartBeats: Number(p.loopStartBeats ?? 0),
                loopEndBeats: Number(p.loopEndBeats ?? 64),
                revision: Number(p.revision ?? message.sequence)
              });
            }
            if (message.type === "sync.presence") setPresence(prev => { const next = prev.filter(p => p.actorId !== message.presence.actorId); return [...next, message.presence]; });
            if (message.type === "sync.cursor") setPresence(prev => prev.map(p => p.actorId === message.actorId ? { ...p, cursor: message.cursor, area: message.area, status: "online" } : p));
            setEvents(prev => [...prev.slice(-199), message]);
          } catch {
            // Ignore malformed server messages without breaking the room connection.
          }
        };
        socket.onerror = () => !closed && setState("error");
        socket.onclose = () => {
          if (closed) return;
          socketRef.current = null;
          setState("offline");
          retryTimer = window.setTimeout(() => void connect(), 500);
        };
      } catch {
        if (closed) return;
        setState("error");
        retryTimer = window.setTimeout(() => void connect(), 1000);
      }
    }

    void connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, [initData]);

  function publish(
    type: CollaborationOperationType,
    targetId: string,
    payload: Record<string, unknown>,
    trackId?: string,
  ) {
    const socket = socketRef.current;
    const identity = identityRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !identity) return false;

    const operation: CollaborationOperation = {
      type, targetId, payload, trackId,
      roomId: String(identity.chatId),
      actorId: identity.userId,
      opId: crypto.randomUUID(),
      clientTime: Date.now(),
    };

    socket.send(JSON.stringify(operation));
    return true;
  }

  function publishTransport(payload: Omit<RoomTransportState, "revision">) {
    return publish("TRANSPORT_SET", "transport", { ...payload, revision: Date.now() });
  }

  function updatePresence(area: string) {
    const identity = identityRef.current; const socket = socketRef.current;
    if (!identity || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "presence.update", presence: { actorId: identity.userId, area, status: "online" } }));
  }
  function publishCursor(x: number, y: number, area: string) {
    const socket = socketRef.current; if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "cursor.move", cursor: { x, y }, area }));
  }
  return { state, events, presence, publish, publishTransport, transport, serverOffsetMs, updatePresence, publishCursor, sequence: sequenceRef.current, roomTicket, chatId };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string } };
  }
}