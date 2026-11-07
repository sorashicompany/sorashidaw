import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBeatRoom } from "./collaboration";
import "./styles.css";

const windows = ["Playlist", "Step Sequencer", "Piano Roll", "Mixer", "Browser", "Synthesizer", "Effects"] as const;
type WindowName = (typeof windows)[number];
type ClipKind = "audio" | "midi" | "pattern" | "loop";
type DrumChannel = { id: string; name: string; sample: string; steps: boolean[]; volume: number; pan: number; mute: boolean; solo: boolean; velocity: number; };

type Track = {
  id: string;
  name: string;
  color: string;
  groupId?: string;
  clips: Clip[];
};

type Clip = {
  id: string;
  name: string;
  kind: ClipKind;
  start: number;
  length: number;
  lane: number;
  selected?: boolean;
};

type Marker = { id: string; position: number; label: string };
type AutomationPoint = { id: string; position: number; value: number };

const GRID = 16;
const DRUM_SAMPLES = ["Deep Kick", "Snare Tight", "Clap Wide", "Closed Hat", "Open Hat", "Perc Click", "808 Sub", "FX Noise"];
const INITIAL_TRACKS: Track[] = [
  { id: "drums", name: "DRUMS", color: "violet", clips: [
    { id: "drums-1", name: "Kit Loop", kind: "pattern", start: 0, length: 16, lane: 0 },
    { id: "drums-2", name: "Fill", kind: "loop", start: 20, length: 12, lane: 0 },
  ]},
  { id: "bass", name: "BASS", color: "cyan", clips: [
    { id: "bass-1", name: "Sub Bass", kind: "midi", start: 4, length: 20, lane: 0 },
  ]},
  { id: "keys", name: "KEYS", color: "amber", clips: [
    { id: "keys-1", name: "Piano", kind: "midi", start: 0, length: 28, lane: 0 },
  ]},
  { id: "synth", name: "SYNTH", color: "magenta", clips: [
    { id: "synth-1", name: "Atmos Pad", kind: "audio", start: 16, length: 24, lane: 0 },
  ]},
];

export default function App() {
  const [active, setActive] = useState<WindowName>("Playlist");
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(128);
  const [bar, setBar] = useState(1);
  const [tracks, setTracks] = useState(INITIAL_TRACKS);
  const [markers, setMarkers] = useState<Marker[]>([{ id: "m1", position: 0, label: "INTRO" }, { id: "m2", position: 32, label: "DROP" }]);
  const [automation, setAutomation] = useState<AutomationPoint[]>([
    { id: "a1", position: 0, value: 42 }, { id: "a2", position: 24, value: 76 }, { id: "a3", position: 40, value: 48 }
  ]);
  const [selectedClip, setSelectedClip] = useState<string | null>("drums-1");
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(4);
  const [grouped, setGrouped] = useState(false);
  const [patternLength, setPatternLength] = useState(16);
  const [drumChannels, setDrumChannels] = useState<DrumChannel[]>([
    { id: "kick", name: "Kick", sample: "Deep Kick", steps: [true,false,false,false,true,false,false,false,true,false,false,false,true,false,false,false], volume: 0, pan: 0, mute: false, solo: false, velocity: 100 },
    { id: "snare", name: "Snare", sample: "Snare Tight", steps: [false,false,false,false,true,false,false,false,false,false,false,false,true,false,false,false], volume: -3, pan: 0, mute: false, solo: false, velocity: 100 },
    { id: "clap", name: "Clap", sample: "Clap Wide", steps: Array(16).fill(false), volume: -6, pan: 0, mute: false, solo: false, velocity: 92 },
    { id: "ch", name: "Closed Hat", sample: "Closed Hat", steps: [false,false,true,false,false,false,true,false,false,false,true,false,false,false,true,false], volume: -8, pan: 0, mute: false, solo: false, velocity: 82 },
    { id: "oh", name: "Open Hat", sample: "Open Hat", steps: [false,false,false,false,false,false,false,false,false,false,false,false,false,true,false,false], volume: -9, pan: 0, mute: false, solo: false, velocity: 90 },
    { id: "perc", name: "Percussion", sample: "Perc Click", steps: [false,false,false,true,false,false,false,false,false,true,false,false,false,false,true,false], volume: -10, pan: -12, mute: false, solo: false, velocity: 76 },
    { id: "808", name: "808", sample: "808 Sub", steps: [true,false,false,false,false,false,false,false,true,false,false,false,false,false,false,false], volume: -4, pan: 0, mute: false, solo: false, velocity: 105 },
    { id: "fx", name: "FX", sample: "FX Noise", steps: Array(16).fill(false), volume: -12, pan: 8, mute: false, solo: false, velocity: 70 },
  ]);
  const [activePattern, setActivePattern] = useState("Pattern 01");
  const [patternNames, setPatternNames] = useState(["Pattern 01", "Pattern 02"]);
  const { state: roomState, presence, updatePresence, publishCursor, publish, events } = useBeatRoom();
  const appliedOps = useRef(new Set<string>());

  useEffect(() => { updatePresence(active); }, [active, updatePresence]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setBar(current => current >= 16 ? 1 : current + 1), 60000 / bpm / 2);
    return () => window.clearInterval(timer);
  }, [playing, bpm]);

  const online = presence.filter(user => user.status === "online");
  const currentUser = presence.find(user => user.status === "online");

  function emit(type: Parameters<typeof publish>[0], targetId: string, payload: Record<string, unknown>, trackId?: string) {
    publish(type, targetId, payload, trackId);
  }

  function updateClip(id: string, patch: Partial<Clip>) {
    setTracks(current => current.map(track => ({ ...track, clips: track.clips.map(clip => clip.id === id ? { ...clip, ...patch } : clip) })));
    const track = tracks.find(item => item.clips.some(clip => clip.id === id));
    emit("MOVE_CLIP", id, patch, track?.id);
  }

  function selectClip(id: string) {
    setSelectedClip(id);
    setTracks(current => current.map(track => ({ ...track, clips: track.clips.map(clip => ({ ...clip, selected: clip.id === id })) })));
  }

  function copyClip() {
    const clip = tracks.flatMap(track => track.clips).find(item => item.id === selectedClip);
    if (clip) setClipboard({ ...clip });
  }

  function pasteClip() {
    if (!clipboard) return;
    const trackId = tracks.find(track => track.clips.some(clip => clip.id === selectedClip))?.id ?? tracks[0].id;
    const pasted: Clip = { ...clipboard, id: crypto.randomUUID(), start: clipboard.start + snap, selected: true };
    setTracks(current => current.map(track => track.id === trackId ? { ...track, clips: [...track.clips, pasted] } : track));
    setSelectedClip(pasted.id);
    emit("PASTE_CLIP", pasted.id, pasted, trackId);
  }

  function duplicateClip() {
    if (!selectedClip) return;
    const source = tracks.flatMap(track => track.clips).find(item => item.id === selectedClip);
    const trackId = tracks.find(track => track.clips.some(clip => clip.id === selectedClip))?.id;
    if (!source || !trackId) return;
    const copy: Clip = { ...source, id: crypto.randomUUID(), start: source.start + source.length, selected: true };
    setTracks(current => current.map(track => track.id === trackId ? { ...track, clips: [...track.clips, copy] } : track));
    setSelectedClip(copy.id);
    emit("DUPLICATE_CLIP", copy.id, copy, trackId);
  }

  function deleteClip() {
    if (!selectedClip) return;
    const trackId = tracks.find(track => track.clips.some(clip => clip.id === selectedClip))?.id;
    setTracks(current => current.map(track => ({ ...track, clips: track.clips.filter(clip => clip.id !== selectedClip) })));
    emit("DELETE_CLIP", selectedClip, {}, trackId);
    setSelectedClip(null);
  }

  function splitClip() {
    const clip = tracks.flatMap(track => track.clips).find(item => item.id === selectedClip);
    const trackId = tracks.find(track => track.clips.some(item => item.id === selectedClip))?.id;
    if (!clip || !trackId || clip.length < 2) return;
    const left: Clip = { ...clip, id: crypto.randomUUID(), length: Math.floor(clip.length / 2) };
    const right: Clip = { ...clip, id: crypto.randomUUID(), start: clip.start + left.length, length: clip.length - left.length, selected: true };
    setTracks(current => current.map(track => track.id === trackId ? { ...track, clips: [...track.clips.filter(item => item.id !== clip.id), left, right] } : track));
    setSelectedClip(right.id);
    emit("SPLIT_CLIP", clip.id, { left, right }, trackId);
  }

  function addClip(kind: ClipKind) {
    const track = tracks[0];
    const clip: Clip = { id: crypto.randomUUID(), name: kind === "audio" ? "Audio Clip" : kind === "midi" ? "MIDI Clip" : kind === "pattern" ? "Pattern" : "Loop", kind, start: snap, length: 8, lane: 0 };
    setTracks(current => current.map(item => item.id === track.id ? { ...item, clips: [...item.clips, clip] } : item));
    setSelectedClip(clip.id);
    emit(kind === "audio" ? "ADD_AUDIO_CLIP" : kind === "midi" ? "ADD_MIDI_CLIP" : kind === "pattern" ? "ADD_PATTERN_CLIP" : "ADD_LOOP_CLIP", clip.id, clip, track.id);
  }

  function addTrack() {
    const track: Track = { id: crypto.randomUUID(), name: "NEW TRACK", color: "violet", clips: [] };
    setTracks(current => [...current, track]);
    emit("ADD_TRACK", track.id, track);
  }

  function addMarker() {
    const marker: Marker = { id: crypto.randomUUID(), position: Math.max(0, bar - 1) * 4, label: "MARKER" };
    setMarkers(current => [...current, marker]);
    emit("ADD_MARKER", marker.id, marker);
  }

  function toggleDrumStep(channelId: string, step: number) {
    setDrumChannels(current => current.map(channel => {
      if (channel.id !== channelId) return channel;
      const next = [...channel.steps];
      next[step] = !next[step];
      emit("CHANGE_PATTERN", channelId, { pattern: activePattern, step, enabled: next[step], length: patternLength }, "drums");
      return { ...channel, steps: next };
    }));
  }

  function updateDrumChannel(channelId: string, patch: Partial<DrumChannel>) {
    setDrumChannels(current => current.map(channel => channel.id === channelId ? { ...channel, ...patch } : channel));
    emit("UPDATE_DRUM_CHANNEL", channelId, { pattern: activePattern, ...patch }, "drums");
  }

  function addPattern() {
    const name = "Pattern " + String(patternNames.length + 1).padStart(2, "0");
    setPatternNames(current => [...current, name]);
    setActivePattern(name);
    emit("ADD_PATTERN_CLIP", crypto.randomUUID(), { name, length: patternLength, pattern: "drums" }, "drums");
  }

  function placePatternInPlaylist() {
    const clip: Clip = { id: crypto.randomUUID(), name: activePattern, kind: "pattern", start: snap, length: patternLength, lane: 0 };
    setTracks(current => current.map(track => track.id === "drums" ? { ...track, clips: [...track.clips, clip] } : track));
    setSelectedClip(clip.id);
    emit("ADD_PATTERN_CLIP", clip.id, clip, "drums");
  }

  function toggleStep(step: number) {
    setSteps(current => {
      const next = current.includes(step) ? current.filter(item => item !== step) : [...current, step];
      emit("CHANGE_PATTERN", "kick", { step, enabled: next.includes(step) }, "drums");
      return next;
    });
  }

  function moveSelected(delta: number) {
    const clip = tracks.flatMap(track => track.clips).find(item => item.id === selectedClip);
    if (!clip) return;
    const nextStart = Math.max(0, clip.start + delta);
    updateClip(clip.id, { start: nextStart });
  }

  function resizeSelected(delta: number) {
    const clip = tracks.flatMap(track => track.clips).find(item => item.id === selectedClip);
    if (!clip) return;
    updateClip(clip.id, { length: Math.max(snap, clip.length + delta) });
  }

  const selected = tracks.flatMap(track => track.clips).find(clip => clip.id === selectedClip);

  return (
    <main className="daw">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">S</div><div><strong>SORASHI DAW</strong><span>shared beat room</span></div></div>
        <div className="project"><button className="project-name">Untitled Beat <span>⌄</span></button><span className="save-state"><i /> Saved</span></div>
        <div className="transport">
          <button className="transport-button" onClick={() => setPlaying(value => !value)}>{playing ? "STOP" : "PLAY"}</button>
          <button className="transport-icon" onClick={() => setBar(1)}>■</button>
          <span className="tempo-label">BPM</span>
          <input value={bpm} type="number" min="40" max="240" onChange={event => { const value = Number(event.target.value); setBpm(value); emit("CHANGE_BPM", "project", { bpm: value }); }} />
          <span className="position">00:{String(bar).padStart(2, "0")}:00</span>
          <span className={roomState === "live" ? "room-status live" : "room-status"}><i />{roomState === "live" ? "LIVE" : roomState.toUpperCase()}</span>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-tabs">{windows.map(windowName => <button key={windowName} className={active === windowName ? "tool-tab active" : "tool-tab"} onClick={() => setActive(windowName)}>{icon(windowName)} {windowName}</button>)}</div>
        <div className="toolbar-right">
          <span>4/4</span><span>{tracks.length * 16} bars</span>
          <label>Snap <select value={snap} onChange={event => { const value = Number(event.target.value); setSnap(value); emit("SET_GRID", "project", { snap: value }); }}><option value={1}>1/16</option><option value={2}>1/8</option><option value={4}>1/4</option><option value={8}>1/2</option></select></label>
          <label>Zoom <input className="zoom-input" type="range" min="0.7" max="2" step="0.1" value={zoom} onChange={event => { const value = Number(event.target.value); setZoom(value); emit("SET_ZOOM", "playlist", { zoom: value }); }} /></label>
        </div>
      </div>

      <div className="main-layout">
        <aside className="left-dock">
          <DockHeader title="BROWSER" action="+" />
          <div className="browser-search">⌕ <span>Search sounds</span></div>
          <div className="browser-section"><span>CLIP TYPE</span>{(["audio", "midi", "pattern", "loop"] as ClipKind[]).map(kind => <button key={kind} onClick={() => addClip(kind)}>+ {kind.toUpperCase()}</button>)}</div>
          <div className="browser-section"><span>PACKS</span>{["Drums", "Bass", "Keys", "Synths", "Textures"].map(item => <button key={item}>› {item}</button>)}</div>
          <div className="browser-section sounds"><span>RECENT</span>{["Deep Kick", "Sub Bass 01", "Warm Piano", "Analog Pad", "Crisp Hat"].map(item => <button key={item} onDoubleClick={() => emit("ADD_SAMPLE", item, { name: item })}><b>♪</b>{item}</button>)}</div>
        </aside>

        <section className="center-stage" onPointerMove={event => publishCursor(event.clientX, event.clientY, active)}>
          <div className="stage-header">
            <div><span className="eyebrow">ARRANGEMENT</span><strong>Playlist / Timeline</strong></div>
            <div className="stage-controls">
              <button onClick={copyClip} title="Copy">⧉</button><button onClick={pasteClip} title="Paste">▣</button><button onClick={duplicateClip} title="Duplicate">⧠</button><button onClick={splitClip} title="Split">╱</button><button onClick={deleteClip} title="Delete">⌫</button><button onClick={addMarker} title="Marker">◆</button><button onClick={addTrack} title="Track">+</button>
            </div>
          </div>

          <div className="arrangement-shell" style={{ "--zoom": zoom } as React.CSSProperties}>
            <div className="timeline-ruler">
              <div className="track-spacer">TRACKS</div>
              <div className="ruler-grid">{Array.from({ length: 32 }, (_, index) => <b key={index}>{index + 1}</b>)}</div>
            </div>

            <div className="marker-row">
              <div className="track-spacer">MARKERS</div>
              <div className="marker-lane">
                {markers.map(marker => <button key={marker.id} className="marker" style={{ left: marker.position * 2.5 + "%" }} onClick={() => setBar(Math.floor(marker.position / 4) + 1)}>{marker.label}</button>)}
              </div>
            </div>

            {tracks.map(track => (
              <div className="arrangement-row" key={track.id}>
                <div className="track-name"><i>{track.name.slice(0, 1)}</i><span>{track.name}</span><small>{track.groupId ? "GROUPED" : "Audio / MIDI"}</small></div>
                <div className="clip-lane" onDoubleClick={() => addClip("midi")}>
                  {track.clips.map(clip => {
                    const left = clip.start * 2.5;
                    const width = Math.max(clip.length * 2.5, 3);
                    return <button key={clip.id} className={"arr-clip " + clip.kind + (selectedClip === clip.id ? " selected" : "")} style={{ left: left + "%", width: width + "%" }} onClick={event => { event.stopPropagation(); selectClip(clip.id); }} onDoubleClick={event => { event.stopPropagation(); selectClip(clip.id); }} title={clip.name}>
                      <span>{clip.name}</span><small>{clip.kind.toUpperCase()}</small>
                    </button>;
                  })}
                </div>
              </div>
            ))}

            <div className="automation-row">
              <div className="track-name"><i>∿</i><span>AUTOMATION</span><small>Filter Cutoff</small></div>
              <div className="automation-lane">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline points={automation.map(point => point.position + "," + (100 - point.value)).join(" ")} />
                </svg>
                {automation.map(point => <button key={point.id} className="automation-point" style={{ left: point.position + "%", bottom: point.value + "%" }} />)}
              </div>
            </div>

            {selected && <div className="clip-inspector">
              <span>SELECTED</span><strong>{selected.name}</strong><small>{selected.kind.toUpperCase()} · {selected.length} beats · position {selected.start}</small>
              <button onClick={() => resizeSelected(snap)}>+ length</button><button onClick={() => resizeSelected(-snap)}>− length</button><button onClick={() => moveSelected(-snap)}>← move</button><button onClick={() => moveSelected(snap)}>move →</button>
            </div>}
          </div>

          <div className="lower-workspace">
            <Panel title="Step Sequencer" subtitle="Drums · 16 steps" className="sequencer-panel">
              <div className="drum-toolbar"><div className="pattern-selector">{patternNames.map(name => <button key={name} className={activePattern === name ? "active" : ""} onClick={() => setActivePattern(name)}>{name}</button>)}<button onClick={addPattern}>+</button></div><div className="pattern-length">{[4,8,16,32,64].map(length => <button key={length} className={patternLength === length ? "active" : ""} onClick={() => { setPatternLength(length); emit("CHANGE_PATTERN", activePattern, { length }, "drums"); }}>{length}</button>)}</div><button className="place-pattern" onClick={placePatternInPlaylist}>Place in Playlist</button></div>
<div className="drum-grid"><div className="drum-head"><span>CHANNEL</span><span>SAMPLE</span><span>VOL</span><span>PAN</span><span>M/S</span><span>VELOCITY</span><span>STEPS</span></div>{drumChannels.map(channel => <div className="drum-row" key={channel.id}><div className="drum-channel"><span className="channel-led" /><strong>{channel.name}</strong></div><select value={channel.sample} onChange={event => updateDrumChannel(channel.id, { sample: event.target.value })}>{DRUM_SAMPLES.map(sample => <option key={sample}>{sample}</option>)}</select><input className="mini-number" value={channel.volume} type="number" min="-60" max="6" onChange={event => updateDrumChannel(channel.id, { volume: Number(event.target.value) })}/><input className="mini-pan" value={channel.pan} type="range" min="-100" max="100" onChange={event => updateDrumChannel(channel.id, { pan: Number(event.target.value) })}/><div className="ms"><button className={channel.mute ? "on" : ""} onClick={() => updateDrumChannel(channel.id, { mute: !channel.mute })}>M</button><button className={channel.solo ? "on" : ""} onClick={() => updateDrumChannel(channel.id, { solo: !channel.solo })}>S</button></div><input className="velocity" value={channel.velocity} type="range" min="1" max="127" onChange={event => updateDrumChannel(channel.id, { velocity: Number(event.target.value) })}/><div className="steps">{Array.from({ length: patternLength }, (_, index) => <button key={index} className={channel.steps[index] ? "step on" : "step"} onClick={() => toggleDrumStep(channel.id, index)} />)}</div></div>)}</div><div className="panel-footer"><span>{drumChannels[0]?.steps.slice(0, patternLength).filter(Boolean).length ?? 0} kick hits</span><span>{patternLength} steps · {activePattern}</span></div>
            </Panel>
            <Panel title="Piano Roll" subtitle="Bass · C minor" className="piano-panel">
              <div className="piano-roll"><div className="piano-keys">{["C", "B", "A", "G", "F", "E", "D"].map(key => <span key={key}>{key}</span>)}</div><div className="note-grid">{Array.from({ length: 12 }, (_, index) => <button key={index} className={"note note-" + index} onClick={() => emit("ADD_NOTE", "bass-note-" + index, { pitch: 60 + index, bar }, "bass")} />)}</div></div>
            </Panel>
          </div>
        </section>

        <aside className="right-dock">
          <DockHeader title="ROOM" action={online.length + " online"} />
          <div className="room-users">{online.map(user => <div className="room-user" key={user.actorId}><span className="user-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.firstName)}</span><div><strong>{user.username ? "@" + user.username : user.firstName}</strong><small>{user.area}</small></div><i className="online-dot" /></div>)}{online.length === 0 && <div className="empty-room">Waiting for collaborators…</div>}</div>
          <DockHeader title="INSPECTOR" action="Reset" />
          <div className="inspector"><div className="inspector-title"><span className="track-icon">D</span><div><strong>{selected?.name ?? "Drums"}</strong><small>{selected ? selected.kind.toUpperCase() : "Shared channel"}</small></div></div>{["Volume", "Pan", "Filter", "Send A"].map((name, index) => <div className="control" key={name}><span>{name}</span><div className="control-line"><i style={{ width: (72 - index * 11) + "%" }} /></div><b>{index === 0 ? "0.0 dB" : index === 1 ? "C" : index === 2 ? "42%" : "-18 dB"}</b></div>)}</div>
          <DockHeader title="SYNTH" action="Poly" /><div className="mini-synth"><div className="waveform">∿∿∿∿∿∿∿∿</div><div className="knobs"><Knob label="Cutoff" /><Knob label="Res" /><Knob label="Attack" /><Knob label="Release" /></div></div>
        </aside>
      </div>

      <footer className="bottom-dock">
        <div className="mixer-title"><span>MIXER</span><small>5 channels</small></div>
        {["Drums", "Bass", "Keys", "Synth", "Master"].map((channel, index) => <div className="mixer-channel" key={channel}><div className="channel-meter"><i style={{ height: (38 + index * 8) + "%" }} /></div><div className="channel-fader"><i style={{ bottom: (25 + index * 8) + "%" }} /></div><strong>{channel}</strong><small>{index === 4 ? "0.0 dB" : index === 0 ? "-1.2 dB" : "-3.0 dB"}</small></div>)}
        <div className="master-strip"><span>MASTER</span><b>-0.3 dB</b><div /></div>
      </footer>

      <div className="remote-cursors">{presence.filter(user => user.status === "online" && user.cursor && user.actorId !== currentUser?.actorId).map(user => <span key={user.actorId} className="remote-cursor" style={{ left: user.cursor!.x, top: user.cursor!.y }}><i />{user.username ? "@" + user.username : user.firstName}<small>{user.area}</small></span>)}</div>
    </main>
  );
}

function Panel({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: ReactNode; className?: string }) {
  return <section className={"panel " + className}><header><div><strong>{title}</strong><small>{subtitle}</small></div><button>•••</button></header>{children}</section>;
}
function DockHeader({ title, action }: { title: string; action: string }) { return <div className="dock-header"><strong>{title}</strong><button>{action}</button></div>; }
function Knob({ label }: { label: string }) { return <div className="knob"><i /><span>{label}</span></div>; }
function initials(name: string) { return name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function icon(windowName: WindowName) { return ({ Playlist: "▤", "Step Sequencer": "▦", "Piano Roll": "⌁", Mixer: "▥", Browser: "⌕", Synthesizer: "◉", Effects: "✦" } as Record<WindowName, string>)[windowName]; }
