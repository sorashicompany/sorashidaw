import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useBeatRoom } from "./collaboration";
import "./styles.css";

// TEMP emergency shell — full App will be restored in next commit if this succeeds
export default function App() {
  const { state: roomState, events, presence } = useBeatRoom();
  return (
    <div style={{ minHeight: "100vh", background: "#0a0b10", color: "#e8eaf0", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Nexora DAW</h1>
      <p>Emergency shell after black-screen crash.</p>
      <p>Room: <b>{roomState}</b> · events: {events.length} · presence: {presence.length}</p>
      <p style={{ opacity: 0.7 }}>Full UI restore in progress.</p>
    </div>
  );
}
