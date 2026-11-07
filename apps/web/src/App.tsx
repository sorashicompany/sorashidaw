import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useBeatRoom } from "./collaboration";
import "./styles.css";

const windows = ["Playlist", "Step Sequencer", "Piano Roll", "Mixer", "Browser", "Synthesizer", "Effects"] as const;
type WindowName = (typeof windows)[number];

const initialSteps = [0, 3, 4, 7, 8, 10, 12, 15];

export default function App() {
  const [active, setActive] = useState<WindowName>("Playlist");
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(128);
  const [steps, setSteps] = useState(initialSteps);
  const [bar, setBar] = useState(1);
  const { state: roomState, presence, updatePresence, publishCursor, publish } = useBeatRoom();

  useEffect(() => {
    updatePresence(active);
  }, [active, updatePresence]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setBar(current => current >= 8 ? 1 : current + 1), 60000 / bpm / 2);
    return () => window.clearInterval(timer);
  }, [playing, bpm]);

  const online = presence.filter(user => user.status === "online");
  const currentUser = presence.find(user => user.status === "online");
  const transportLabel = playing ? "STOP" : "PLAY";
  const roomLabel = roomState === "live" ? "LIVE" : roomState.toUpperCase();

  function toggleStep(step: number) {
    setSteps(current => {
      const next = current.includes(step) ? current.filter(item => item !== step) : [...current, step];
      publish("CHANGE_PATTERN", "kick", { step, enabled: next.includes(step) }, "drums");
      return next;
    });
  }

  return (
    <main className="daw">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SORASHI DAW</strong>
            <span>shared beat room</span>
          </div>
        </div>

        <div className="project">
          <button className="project-name">Untitled Beat <span>⌄</span></button>
          <span className="save-state"><i /> Saved</span>
        </div>

        <div className="transport">
          <button className="transport-button" onClick={() => setPlaying(!playing)}>{transportLabel}</button>
          <button className="transport-icon" onClick={() => setBar(1)}>■</button>
          <span className="tempo-label">BPM</span>
          <input value={bpm} type="number" min="40" max="240" onChange={event => setBpm(Number(event.target.value))} />
          <span className="position">00:{String(bar).padStart(2, "0")}:00</span>
          <span className={roomState === "live" ? "room-status live" : "room-status"}><i />{roomLabel}</span>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-tabs">
          {windows.map(windowName => (
            <button key={windowName} className={active === windowName ? "tool-tab active" : "tool-tab"} onClick={() => setActive(windowName)}>
              {icon(windowName)} {windowName}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <span>4/4</span><span>120 bars</span><span>Snap 1/16</span>
          <button className="small-button">⌘K</button>
        </div>
      </div>

      <div className="main-layout">
        <aside className="left-dock">
          <DockHeader title="BROWSER" action="+" />
          <div className="browser-search">⌕ <span>Search sounds</span></div>
          <div className="browser-section">
            <span>PACKS</span>
            {["Drums", "Bass", "Keys", "Synths", "Textures"].map(item => <button key={item}>› {item}</button>)}
          </div>
          <div className="browser-section sounds">
            <span>RECENT</span>
            {["Deep Kick", "Sub Bass 01", "Warm Piano", "Analog Pad", "Crisp Hat"].map(item => (
              <button key={item} onDoubleClick={() => publish("ADD_SAMPLE", item, { name: item })}><b>♪</b>{item}</button>
            ))}
          </div>
        </aside>

        <section className="center-stage" onPointerMove={event => publishCursor(event.clientX, event.clientY, active)}>
          <div className="stage-header">
            <div>
              <span className="eyebrow">ARRANGEMENT</span>
              <strong>{active}</strong>
            </div>
            <div className="stage-controls">
              <button>←</button><button>→</button><button>⌕</button><button>+</button>
            </div>
          </div>

          <div className="arrangement">
            <div className="ruler">
              <span>TRACK</span>
              {Array.from({ length: 16 }, (_, index) => <b key={index}>{index + 1}</b>)}
            </div>
            {[
              ["DRUMS", "beat", "D"],
              ["BASS", "bass", "B"],
              ["KEYS", "keys", "K"],
              ["SYNTH", "synth", "S"]
            ].map(([name, cls, letter], row) => (
              <div className="arrangement-row" key={name}>
                <div className="track-name"><i>{letter}</i><span>{name}</span><small>{row === 0 ? "808 + Kit" : row === 1 ? "Sub Bass" : row === 2 ? "Piano" : "Pad"}</small></div>
                <div className="clip-lane">
                  {Array.from({ length: 16 }, (_, index) => (
                    <button
                      key={index}
                      className={"arr-clip " + cls + (index === bar - 1 ? " current" : "")}
                      onClick={() => setBar(index + 1)}
                    >
                      {index % 4 === 0 ? (index / 4 + 1) : ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="lower-workspace">
            <Panel title="Step Sequencer" subtitle="Drums · 16 steps" className="sequencer-panel">
              <div className="step-grid">
                {["KICK", "SNARE", "HAT"].map((name, row) => (
                  <div className="step-row" key={name}>
                    <span>{name}</span>
                    <div>
                      {Array.from({ length: 16 }, (_, index) => {
                        const activeStep = row === 0 ? steps.includes(index) : row === 1 ? [4, 12].includes(index) : [2, 6, 10, 14].includes(index);
                        return <button key={index} className={activeStep ? "step on" : "step"} onClick={() => row === 0 && toggleStep(index)} />;
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="panel-footer"><span>{steps.length} kick hits</span><span>Velocity 100</span></div>
            </Panel>

            <Panel title="Piano Roll" subtitle="Bass · C minor" className="piano-panel">
              <div className="piano-roll">
                <div className="piano-keys">{["C", "B", "A", "G", "F", "E", "D"].map(key => <span key={key}>{key}</span>)}</div>
                <div className="note-grid">
                  {Array.from({ length: 12 }, (_, index) => <button key={index} className={"note note-" + index} onClick={() => publish("ADD_NOTE", "bass-note-" + index, { pitch: 60 + index, bar })} />)}
                </div>
              </div>
            </Panel>
          </div>
        </section>

        <aside className="right-dock">
          <DockHeader title="ROOM" action={online.length + " online"} />
          <div className="room-users">
            {online.map(user => (
              <div className="room-user" key={user.actorId}>
                <span className="user-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.firstName)}</span>
                <div><strong>{user.username ? "@" + user.username : user.firstName}</strong><small>{user.area}</small></div>
                <i className="online-dot" />
              </div>
            ))}
            {online.length === 0 && <div className="empty-room">Waiting for collaborators…</div>}
          </div>

          <DockHeader title="INSPECTOR" action="Reset" />
          <div className="inspector">
            <div className="inspector-title"><span className="track-icon">D</span><div><strong>Drums</strong><small>Shared channel</small></div></div>
            {["Volume", "Pan", "Filter", "Send A"].map((name, index) => <div className="control" key={name}><span>{name}</span><div className="control-line"><i style={{ width: (72 - index * 11) + "%" }} /></div><b>{index === 0 ? "0.0 dB" : index === 1 ? "C" : index === 2 ? "42%" : "-18 dB"}</b></div>)}
          </div>

          <DockHeader title="SYNTH" action="Poly" />
          <div className="mini-synth">
            <div className="waveform">∿∿∿∿∿∿∿∿</div>
            <div className="knobs"><Knob label="Cutoff" /><Knob label="Res" /><Knob label="Attack" /><Knob label="Release" /></div>
          </div>
        </aside>
      </div>

      <footer className="bottom-dock">
        <div className="mixer-title"><span>MIXER</span><small>5 channels</small></div>
        {["Drums", "Bass", "Keys", "Synth", "Master"].map((channel, index) => (
          <div className="mixer-channel" key={channel}>
            <div className="channel-meter"><i style={{ height: (38 + index * 8) + "%" }} /></div>
            <div className="channel-fader"><i style={{ bottom: (25 + index * 8) + "%" }} /></div>
            <strong>{channel}</strong>
            <small>{index === 4 ? "0.0 dB" : index === 0 ? "-1.2 dB" : "-3.0 dB"}</small>
          </div>
        ))}
        <div className="master-strip"><span>MASTER</span><b>-0.3 dB</b><div /></div>
      </footer>

      <div className="remote-cursors">
        {presence.filter(user => user.status === "online" && user.cursor && user.actorId !== currentUser?.actorId).map(user => (
          <span key={user.actorId} className="remote-cursor" style={{ left: user.cursor!.x, top: user.cursor!.y }}>
            <i />{user.username ? "@" + user.username : user.firstName}<small>{user.area}</small>
          </span>
        ))}
      </div>
    </main>
  );
}

function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  return <section className={"panel " + className}>
    <header><div><strong>{title}</strong><small>{subtitle}</small></div><button>•••</button></header>
    {children}
  </section>;
}

function DockHeader({ title, action }: { title: string; action: string }) {
  return <div className="dock-header"><strong>{title}</strong><button>{action}</button></div>;
}

function Knob({ label }: { label: string }) {
  return <div className="knob"><i /><span>{label}</span></div>;
}

function initials(name: string) {
  return name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function icon(windowName: WindowName) {
  return ({ Playlist: "▤", "Step Sequencer": "▦", "Piano Roll": "⌁", Mixer: "▥", Browser: "⌕", Synthesizer: "◉", Effects: "✦" } as Record<WindowName, string>)[windowName];
}
