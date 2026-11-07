import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useBeatRoom } from "./collaboration";
import "./styles.css";
import { WAVETABLES, SYNTH_PRESETS, type SynthState } from "../../../packages/shared/src/synth";
import { BUILT_IN_EFFECTS, defaultEffectParams, type BuiltInEffectType, type EffectInstance, type ParametricEqBand, DEFAULT_EQ_BANDS } from "../../../packages/shared/src/effects";
import { AudioFxEngine } from "./audio-fx";
import { RealAudioEngine } from "./audio-engine";
import { defaultExportTargets, exportMidi, exportMp3IfSupported, renderWav, type ExportProject, type ExportTarget } from "./export";
type MidiCc = { controller: number; value: number; channel: number };
type MixerChannel = { id:string; name:string; type:"channel"|"bus"|"group"|"send"|"master"; volume:number; pan:number; mute:boolean; solo:boolean; peak:number; route:string; inserts:string[]; sends:Record<string,number>; busId?:string; };

const windows = ["Playlist", "Step Sequencer", "Piano Roll", "Mixer", "Browser", "Synthesizer", "Effects"] as const;
type WindowName = (typeof windows)[number];
type ClipKind = "audio" | "midi" | "pattern" | "loop";
type DrumChannel = { id: string; name: string; sample: string; sampleId?: string; steps: boolean[]; volume: number; pan: number; mute: boolean; solo: boolean; velocity: number; };
type DrumAsset = { id: string; name: string; category: string; folder: string; mimeType: string; size: number; previewUrl?: string; };
type MidiNote = { id: string; pitch: number; start: number; length: number; velocity: number; selected?: boolean };
const INITIAL_SYNTH: SynthState = { polyphony: 16, glide: 0.04, masterVolume: 0, oscillators: [
  { id:"osc1", enabled:true, type:"wavetable", wavetableId:"basic-shapes", wavetablePosition:18, volume:0, octave:0, semitone:0, fine:0, unison:1, detune:0, phase:0 },
  { id:"osc2", enabled:true, type:"wavetable", wavetableId:"spectral", wavetablePosition:42, volume:-6, octave:-1, semitone:0, fine:0, unison:2, detune:8, phase:180 },
  { id:"osc3", enabled:false, type:"saw", wavetableId:"basic-shapes", wavetablePosition:0, volume:-12, octave:1, semitone:7, fine:0, unison:1, detune:0, phase:0 }
], noise:{enabled:false,volume:-18,color:50}, filter:{type:"lowpass",cutoff:7200,resonance:18,drive:0}, ampEnv:{attack:.01,decay:.25,sustain:.78,release:.35}, filterEnv:{attack:.01,decay:.4,sustain:.45,release:.3}, lfos:[{id:"lfo1",rate:4,shape:"sine",sync:true,amount:32},{id:"lfo2",rate:.5,shape:"triangle",sync:false,amount:12}], routes:[{id:"r1",source:"LFO 1",destination:"Filter Cutoff",amount:34},{id:"r2",source:"ENV 2",destination:"Wavetable Position",amount:22}] };

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
type ChangePath = Array<string | { id: string }>;
type SnapshotChange = { path: ChangePath; before: unknown; after: unknown };

function cloneSnapshot<T>(value: T): T { return structuredClone(value); }
function sameValue(a: unknown, b: unknown): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
function isIdArray(value: unknown): value is Array<{ id: string }> {
  return Array.isArray(value) && value.every(item => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
}
function diffSnapshots(before: any, after: any, path: ChangePath = [], out: SnapshotChange[] = []): SnapshotChange[] {
  if (sameValue(before, after)) return out;
  if (isIdArray(before) && isIdArray(after)) {
    const beforeMap = new Map(before.map(item => [item.id, item]));
    const afterMap = new Map(after.map(item => [item.id, item]));
    for (const item of before) if (!afterMap.has(item.id)) out.push({ path: [...path, { id: item.id }], before: cloneSnapshot(item), after: undefined });
    for (const item of after) if (!beforeMap.has(item.id)) out.push({ path: [...path, { id: item.id }], before: undefined, after: cloneSnapshot(item) });
    for (const id of new Set([...beforeMap.keys(), ...afterMap.keys()])) if (beforeMap.has(id) && afterMap.has(id)) diffSnapshots(beforeMap.get(id), afterMap.get(id), [...path, { id }], out);
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let i = 0; i < before.length; i++) diffSnapshots(before[i], after[i], [...path, String(i)], out);
    return out;
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) diffSnapshots(before[key], after[key], [...path, key], out);
    return out;
  }
  out.push({ path, before: cloneSnapshot(before), after: cloneSnapshot(after) });
  return out;
}
function readSnapshotPath(root: any, path: ChangePath): unknown {
  let current = root;
  for (const token of path) {
    if (current === undefined || current === null) return undefined;
    if (typeof token === "string") current = current[token];
    else current = Array.isArray(current) ? current.find(item => item?.id === token.id) : undefined;
  }
  return current;
}
function writeSnapshotPath(root: any, path: ChangePath, value: unknown, expected: unknown): void {
  if (!path.length) return;
  let current = root;
  for (let i = 0; i < path.length - 1; i++) {
    const token = path[i];
    if (typeof token === "string") current = current[token];
    else current = Array.isArray(current) ? current.find(item => item?.id === token.id) : undefined;
    if (current === undefined) return;
  }
  const last = path[path.length - 1];
  if (typeof last === "string") {
    if (sameValue(current[last], expected)) current[last] = value;
    return;
  }
  if (!Array.isArray(current)) return;
  const index = current.findIndex(item => item?.id === last.id);
  if (value === undefined) {
    if (index >= 0 && sameValue(current[index], expected)) current.splice(index, 1);
  } else if (index < 0) {
    current.push(cloneSnapshot(value));
  } else if (sameValue(current[index], expected)) {
    current[index] = cloneSnapshot(value);
  }
}
function applySnapshotChanges(current: any, changes: SnapshotChange[], direction: "undo" | "redo"): any {
  const next = cloneSnapshot(current);
  for (const change of changes) {
    const expected = direction === "undo" ? change.after : change.before;
    const value = direction === "undo" ? change.before : change.after;
    writeSnapshotPath(next, change.path, value, expected);
  }
  return next;
}


type AutomationTarget = "volume" | "pan" | "filter.cutoff" | "synth.parameter" | "effect.parameter" | "send" | "master.parameter";
type AutomationPoint = { id: string; position: number; value: number };
type AutomationLane = { id: string; targetId: string; target: AutomationTarget; parameter: string; label: string; points: AutomationPoint[] };

const GRID = 16;
const DRUM_SAMPLES = ["Deep Kick", "Snare Tight", "Clap Wide", "Closed Hat", "Open Hat", "Perc Click", "808 Sub", "FX Noise"];
const INITIAL_EFFECTS: EffectInstance[] = BUILT_IN_EFFECTS.slice(0, 6).map((item, index) => ({ id: "fx-" + index, type: item.type, name: item.name, bypass: false, mix: 100, params: defaultEffectParams(item.type) }));

const INITIAL_MIXER: MixerChannel[] = [
 {id:"drums",name:"Drums",type:"channel",volume:-1.2,pan:0,mute:false,solo:false,peak:-6,route:"Drum Bus",inserts:["Transient","Saturator"],sends:{A:-18,B:-24},busId:"drum-bus"},
 {id:"bass",name:"Bass",type:"channel",volume:-3,pan:0,mute:false,solo:false,peak:-9,route:"Music Bus",inserts:["EQ","Compressor"],sends:{A:-24,B:-30},busId:"music-bus"},
 {id:"keys",name:"Keys",type:"channel",volume:-3,pan:-8,mute:false,solo:false,peak:-12,route:"Music Bus",inserts:["EQ"],sends:{A:-20,B:-30},busId:"music-bus"},
 {id:"synth",name:"Synth",type:"channel",volume:-4,pan:12,mute:false,solo:false,peak:-7,route:"Music Bus",inserts:["Filter","Chorus"],sends:{A:-15,B:-20},busId:"music-bus"},
 {id:"drum-bus",name:"Drum Bus",type:"bus",volume:-1,pan:0,mute:false,solo:false,peak:-5,route:"MASTER",inserts:["Glue Comp"],sends:{A:-12},},
 {id:"music-bus",name:"Music Bus",type:"bus",volume:-2,pan:0,mute:false,solo:false,peak:-8,route:"MASTER",inserts:["EQ","Limiter"],sends:{A:-18},},
 {id:"fx-group",name:"FX Group",type:"group",volume:-6,pan:0,mute:false,solo:false,peak:-14,route:"MASTER",inserts:["Reverb"],sends:{A:-10},},
 {id:"send-a",name:"Reverb A",type:"send",volume:-8,pan:0,mute:false,solo:false,peak:-18,route:"MASTER",inserts:["Hall Reverb"],sends:{}},
 {id:"master",name:"Master",type:"master",volume:0,pan:0,mute:false,solo:false,peak:-3,route:"OUTPUT",inserts:["Glue","Limiter"],sends:{}}
];
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
  const [automation, setAutomation] = useState<AutomationLane[]>([
    { id:"auto-filter", targetId:"synth", target:"filter.cutoff", parameter:"cutoff", label:"Filter Cutoff", points:[
      { id:"a1", position:0, value:42 }, { id:"a2", position:24, value:76 }, { id:"a3", position:40, value:48 }
    ] },
    { id:"auto-master", targetId:"master", target:"volume", parameter:"volume", label:"Master Volume", points:[
      { id:"mv1", position:0, value:72 }, { id:"mv2", position:32, value:86 }
    ] },
    { id:"auto-pan", targetId:"synth", target:"pan", parameter:"pan", label:"Synth Pan", points:[
      { id:"p1", position:0, value:35 }, { id:"p2", position:24, value:65 }, { id:"p3", position:48, value:50 }
    ] },
    { id:"auto-synth", targetId:"synth", target:"synth.parameter", parameter:"filter.cutoff", label:"Synth Cutoff", points:[
      { id:"s1", position:0, value:25 }, { id:"s2", position:16, value:80 }, { id:"s3", position:40, value:45 }
    ] },
    { id:"auto-send", targetId:"send-a", target:"send", parameter:"sendA", label:"Reverb Send", points:[
      { id:"r1", position:0, value:18 }, { id:"r2", position:32, value:62 }
    ] },
    { id:"auto-effect", targetId:"masterfx:fx-auto", target:"master.parameter", parameter:"fx-auto.mix", label:"Master Effect", points:[
      { id:"e1", position:0, value:30 }, { id:"e2", position:32, value:75 }
    ] }
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
  const [pianoNotes, setPianoNotes] = useState<MidiNote[]>([{ id: "n1", pitch: 60, start: 0, length: 2, velocity: 100 }, { id: "n2", pitch: 64, start: 2, length: 2, velocity: 86 }, { id: "n3", pitch: 67, start: 4, length: 4, velocity: 92 }, { id: "n4", pitch: 72, start: 8, length: 2, velocity: 110 }]);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [pianoZoom, setPianoZoom] = useState(1);
  const [pianoSnap, setPianoSnap] = useState(1);
  const [scaleRoot, setScaleRoot] = useState(0);
  const [scaleMode, setScaleMode] = useState("minor");
  const [synth, setSynth] = useState<SynthState>(INITIAL_SYNTH);
  const [synthTab, setSynthTab] = useState("OSC");
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiChannel, setMidiChannel] = useState(1);
  const [midiCC, setMidiCC] = useState<MidiCc[]>([]);
  const [midiHeld, setMidiHeld] = useState<number[]>([]);
  const [mixer, setMixer] = useState<MixerChannel[]>(INITIAL_MIXER);
  const [effects, setEffects] = useState<EffectInstance[]>(INITIAL_EFFECTS);
  const [masterEffects, setMasterEffects] = useState<EffectInstance[]>([]);
  const [masterMeter, setMasterMeter] = useState(-Infinity);
  const projectHydratedRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const buildProjectSnapshot = () => ({
    schemaVersion: 1, bpm, tracks, markers, automation,
    pianoNotes: pianoNotes.map(({ selected, ...note }) => note),
    drumChannels, patternLength, activePattern, patternNames, synth, effects, masterEffects, mixer,
    loop: { enabled: loopEnabled, startBeats: loopStartBeats, endBeats: loopEndBeats },
    assets: drumAssets.map(({ previewUrl, ...asset }) => asset),
  });

  const scheduleProjectSave = () => {
    if (!projectHydratedRef.current || !projectLoaded || !chatId) return;
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveProjectState(buildProjectSnapshot()), 900);
  };
  const [drumAssets, setDrumAssets] = useState<DrumAsset[]>([]);
  const [assetCategory, setAssetCategory] = useState("Kicks");
  const [browserCategory, setBrowserCategory] = useState("Samples");
  const [browserSearch, setBrowserSearch] = useState("");
  const [browserFolder, setBrowserFolder] = useState("All");
  const [activeAutomationLane, setActiveAutomationLane] = useState("auto-filter");
  useEffect(() => {
    if (projectHydratedRef.current || !projectLoaded) return;
    if (!savedProjectState || typeof savedProjectState !== "object") { projectHydratedRef.current = true; return; }
    const saved = savedProjectState as any;
    if (typeof saved.bpm === "number") setBpm(saved.bpm);
    if (Array.isArray(saved.tracks)) setTracks(saved.tracks);
    if (Array.isArray(saved.markers)) setMarkers(saved.markers);
    if (Array.isArray(saved.automation)) setAutomation(saved.automation);
    if (Array.isArray(saved.pianoNotes)) setPianoNotes(saved.pianoNotes);
    if (Array.isArray(saved.drumChannels)) setDrumChannels(saved.drumChannels);
    if (typeof saved.patternLength === "number") setPatternLength(saved.patternLength);
    if (typeof saved.activePattern === "string") setActivePattern(saved.activePattern);
    if (Array.isArray(saved.patternNames)) setPatternNames(saved.patternNames);
    if (saved.synth && typeof saved.synth === "object") setSynth(saved.synth);
    if (Array.isArray(saved.effects)) setEffects(saved.effects);
    if (Array.isArray(saved.masterEffects)) setMasterEffects(saved.masterEffects);
    if (Array.isArray(saved.mixer)) setMixer(saved.mixer);
    if (saved.loop) {
      setLoopEnabled(Boolean(saved.loop.enabled));
      setLoopStartBeats(Number(saved.loop.startBeats ?? 0));
      setLoopEndBeats(Number(saved.loop.endBeats ?? 64));
    }
    projectHydratedRef.current = true;
  }, [savedProjectState, projectLoaded]);

  useEffect(() => {
    scheduleProjectSave();
    return () => { if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current); };
  }, [bpm, tracks, markers, automation, pianoNotes, drumChannels, patternLength, activePattern, patternNames, synth, effects, masterEffects, mixer, loopEnabled, loopStartBeats, loopEndBeats, drumAssets, chatId]);

  const [gainReduction, setGainReduction] = useState<Record<string, number>>({});
  const audioFxRef = useRef<AudioFxEngine | null>(null);
  const eqCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const masterTestOscRef = useRef<OscillatorNode | null>(null);
  const realAudioEngineRef = useRef<RealAudioEngine | null>(null);
  const { state: roomState, presence, updatePresence, publishCursor, publish, publishTransport, transport, roomTicket, chatId, userId, serverOffsetMs, projectState: savedProjectState, projectLoaded, saveProjectState, getProjectHistory, restoreProjectVersion } = useBeatRoom();
  const appliedOps = useRef(new Set<string>());
  type LocalHistoryEntry = { opId: string; type: string; changes: SnapshotChange[]; before: any; after: any };
  const undoStackRef = useRef<LocalHistoryEntry[]>([]);
  const redoStackRef = useRef<LocalHistoryEntry[]>([]);
  const committedSnapshotRef = useRef<any>(null);
  const pendingHistoryRef = useRef<{ opId: string; type: string; before: any } | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  const [projectHistory, setProjectHistory] = useState<Array<{version:number;label:string;createdAt:string}>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTargetId, setExportTargetId] = useState("master");
  const [exportBusy, setExportBusy] = useState(false);

  const applyProjectSnapshot = (snapshot: any) => {
    if (typeof snapshot.bpm === "number") setBpm(snapshot.bpm);
    if (Array.isArray(snapshot.tracks)) setTracks(snapshot.tracks);
    if (Array.isArray(snapshot.markers)) setMarkers(snapshot.markers);
    if (Array.isArray(snapshot.automation)) setAutomation(snapshot.automation);
    if (Array.isArray(snapshot.pianoNotes)) setPianoNotes(snapshot.pianoNotes);
    if (Array.isArray(snapshot.drumChannels)) setDrumChannels(snapshot.drumChannels);
    if (typeof snapshot.patternLength === "number") setPatternLength(snapshot.patternLength);
    if (typeof snapshot.activePattern === "string") setActivePattern(snapshot.activePattern);
    if (Array.isArray(snapshot.patternNames)) setPatternNames(snapshot.patternNames);
    if (snapshot.synth) setSynth(snapshot.synth);
    if (Array.isArray(snapshot.effects)) setEffects(snapshot.effects);
    if (Array.isArray(snapshot.masterEffects)) setMasterEffects(snapshot.masterEffects);
    if (Array.isArray(snapshot.mixer)) setMixer(snapshot.mixer);
    if (Array.isArray(snapshot.assets)) setDrumAssets(snapshot.assets);
    if (snapshot.loop) {
      setLoopEnabled(Boolean(snapshot.loop.enabled));
      setLoopStartBeats(Number(snapshot.loop.startBeats ?? 0));
      setLoopEndBeats(Number(snapshot.loop.endBeats ?? 64));
    }
  };

  useEffect(() => {
    const current = buildProjectSnapshot();
    const pending = pendingHistoryRef.current;
    if (pending) {
      const after = cloneSnapshot(current);
      const changes = diffSnapshots(pending.before, after);
      if (changes.length) {
        undoStackRef.current = [...undoStackRef.current.slice(-49), { opId: pending.opId, type: pending.type, before: pending.before, after, changes }];
        redoStackRef.current = [];
        setUndoDepth(undoStackRef.current.length);
        setRedoDepth(0);
      }
      pendingHistoryRef.current = null;
    }
    committedSnapshotRef.current = current;
  });

  useEffect(() => {
    if (!projectLoaded || !chatId) return;
    void getProjectHistory().then(setProjectHistory);
  }, [projectLoaded, chatId]);

  const performCollaborativeUndo = () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const current = buildProjectSnapshot();
    const next = applySnapshotChanges(current, entry.changes, "undo");
    applyProjectSnapshot(next);
    publish("UNDO_PATCH", entry.opId, { changes: entry.changes, direction: "undo", originalActorId: currentUser?.actorId ?? 0 });
    redoStackRef.current.push(entry);
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
  };

  const performCollaborativeRedo = () => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    const current = buildProjectSnapshot();
    const next = applySnapshotChanges(current, entry.changes, "redo");
    applyProjectSnapshot(next);
    publish("REDO_PATCH", entry.opId, { changes: entry.changes, direction: "redo", originalActorId: currentUser?.actorId ?? 0 });
    undoStackRef.current.push(entry);
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
  };

  const engineAutomation = (lane: AutomationLane, value: number) => {
    const engine = realAudioEngineRef.current;
    if (!engine) return;
    if (lane.target === "effect.parameter" || lane.target === "master.parameter") {
      engine.setAutomationValue(lane.target, lane.parameter, value);
      return;
    }
    engine.setAutomationValue(lane.target, lane.parameter, value);
  };

  const automationValueAt = (lane: AutomationLane, position: number) => {
    const points = [...lane.points].sort((a,b) => a.position - b.position);
    if (!points.length) return 0;
    if (position <= points[0].position) return points[0].value;
    if (position >= points[points.length - 1].position) return points[points.length - 1].value;
    for (let i=1; i<points.length; i++) {
      if (position <= points[i].position) {
        const a = points[i-1], b = points[i];
        const t = (position-a.position) / Math.max(.0001, b.position-a.position);
        return a.value + (b.value-a.value)*t;
      }
    }
    return points[points.length-1].value;
  };

  const publishAutomationPoint = (lane: AutomationLane, point: AutomationPoint) => {
    setAutomation(current => current.map(item => item.id === lane.id ? { ...item, points: [...item.points.filter(p => p.id !== point.id), point].sort((a,b) => a.position-b.position) } : item));
    publish("SET_AUTOMATION", lane.id, { laneId: lane.id, targetId: lane.targetId, target: lane.target, parameter: lane.parameter, point });
  };

  const addAutomationPoint = (event: MouseEvent<HTMLDivElement>, lane: AutomationLane) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.max(0, Math.min(100, Math.round(((event.clientX - rect.left) / rect.width) * 100 / 2.5) * 2.5));
    const value = Math.max(0, Math.min(100, 100 - ((event.clientY - rect.top) / rect.height) * 100));
    publishAutomationPoint(lane, { id: crypto.randomUUID(), position, value });
  };

  const automationParamValue = (lane: AutomationLane, value: number) => {
    if (lane.target === "filter.cutoff") return 40 + Math.pow(value / 100, 2) * 19960;
    if (lane.target === "volume" || lane.target === "send") return -60 + value * .6;
    if (lane.target === "pan") return value * 2 - 100;
    return value;
  };

  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStartBeats, setLoopStartBeats] = useState(0);
  const [loopEndBeats, setLoopEndBeats] = useState(64);
  const [transportPosition, setTransportPosition] = useState(0);

  const ensureAudioEngine = () => {
    if (!realAudioEngineRef.current) {
      realAudioEngineRef.current = new RealAudioEngine();
      realAudioEngineRef.current.onBar = nextBar => setBar(nextBar);
    }
    return realAudioEngineRef.current;
  };

  const localTransportPosition = () => {
    if (!transport) return transportPosition;
    if (!transport.playing) return transport.positionBeats;
    const elapsed = Math.max(0, (Date.now() + serverOffsetMs - transport.startedAtServerMs) / 1000);
    let position = transport.positionBeats + elapsed * transport.bpm / 60;
    if (transport.loopEnabled && transport.loopEndBeats > transport.loopStartBeats) {
      const length = transport.loopEndBeats - transport.loopStartBeats;
      if (position >= transport.loopEndBeats) position = transport.loopStartBeats + ((position - transport.loopStartBeats) % length);
    }
    return position;
  };

  const publishStart = async () => {
    const engine = ensureAudioEngine();
    await engine.setMasterChain(masterEffects);
    engine.setState(bpm, drumChannels, pianoNotes);
    const startAtServerMs = Date.now() + serverOffsetMs + 350;
    const payload = { playing:true, bpm, positionBeats: transport ? localTransportPosition() : transportPosition, startedAtServerMs:startAtServerMs, loopEnabled, loopStartBeats, loopEndBeats };
    publishTransport(payload);
    setPlaying(true);
  };

  const publishPause = async () => {
    const position = localTransportPosition();
    const engine = ensureAudioEngine();
    publishTransport({ playing:false, bpm, positionBeats:position, startedAtServerMs:0, loopEnabled, loopStartBeats, loopEndBeats });
    setPlaying(false);
    setTransportPosition(position);
  };

  const publishStop = async () => {
    const engine = ensureAudioEngine();
    publishTransport({ playing:false, bpm, positionBeats:0, startedAtServerMs:0, loopEnabled, loopStartBeats, loopEndBeats });
    setPlaying(false);
    setTransportPosition(0);
    setBar(1);
  };

  const togglePlayback = async () => {
    if (transport?.playing || playing) await publishPause();
    else await publishStart();
  };

  useEffect(() => {
    if (!transport) return;
    setPlaying(transport.playing);
    setBpm(transport.bpm);
    setLoopEnabled(transport.loopEnabled);
    setLoopStartBeats(transport.loopStartBeats);
    setLoopEndBeats(transport.loopEndBeats);
  }, [transport]);
  
  useEffect(() => {
    if (!transport) return;
    const engine = ensureAudioEngine();
    engine.setState(transport.bpm, drumChannels, pianoNotes);
    void engine.setMasterChain(masterEffects).then(() => {
      if (transport.playing) {
        const delayMs = Math.max(20, transport.startedAtServerMs - (Date.now() + serverOffsetMs));
        void engine.scheduleTransport(true, transport.bpm, engine.context.currentTime + delayMs / 1000, transport.positionBeats, transport.loopEnabled, transport.loopStartBeats, transport.loopEndBeats);
      } else if (transport.positionBeats === 0) {
        engine.stop();
      } else {
        void engine.setPlaying(false, transport.bpm, transport.positionBeats);
      }
    });
  }, [transport?.revision]);


  useEffect(() => {
    const tick = () => {
      const position = localTransportPosition();
      setTransportPosition(position);
      setBar(Math.floor(position / 4) + 1);
      requestAnimationFrame(tick);
    };
    const id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [transport, serverOffsetMs, bpm]);

  useEffect(() => {
    const engine = realAudioEngineRef.current;
    if (!engine) return;
    engine.setState(bpm, drumChannels, pianoNotes);
  }, [bpm, drumChannels, pianoNotes]);
  
  useEffect(() => {
    if (!transport?.playing) return;
    const tick = () => {
      const position = localTransportPosition();
      for (const lane of automation) {
        const raw = automationValueAt(lane, position);
        engineAutomation(lane, automationParamValue(lane, raw));
      }
    };
    const id = window.setInterval(tick, 40);
    tick();
    return () => window.clearInterval(id);
  }, [transport?.playing, transport?.revision, automation, bpm, serverOffsetMs]);

  useEffect(() => {
    const engine = realAudioEngineRef.current;
    if (!engine) return;
    engine.setState(bpm, drumChannels, pianoNotes);
  }, [bpm, drumChannels, pianoNotes]);

  useEffect(() => {
    const engine = realAudioEngineRef.current;
    if (!engine || !playing) return;
    void engine.setMasterChain(masterEffects);
  }, [masterEffects, playing]);

  useEffect(() => () => {
    realAudioEngineRef.current?.stop();
  }, []);

  useEffect(() => { updatePresence(active); }, [active, updatePresence]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const engine = audioFxRef.current;
      if (engine) {
        setMasterMeter(engine.getMeterLevel("master-channel"));
        const next: Record<string, number> = {};
        effects.filter(effect => effect.type === "compressor").forEach(effect => {
          next[effect.id] = engine.getGainReduction("effects-audition", effect.id);
        });
        setGainReduction(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [effects]);

  useEffect(() => {
    if (!roomTicket || !chatId) return;
    fetch("/api/room/assets?chatId=" + encodeURIComponent(String(chatId)) + "&ticket=" + encodeURIComponent(roomTicket))
      .then(response => response.ok ? response.json() as Promise<{ assets: DrumAsset[] }> : Promise.reject(new Error("asset list failed")))
      .then(result => setDrumAssets(result.assets))
      .catch(() => undefined);
  }, [roomTicket, chatId]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation") continue;
      const op = event.operation;
      if (op.type === "SET_AUTOMATION") {
        const laneId = String(op.payload.laneId ?? op.targetId);
        const point = op.payload.point as AutomationPoint | undefined;
        if (point) {
          setAutomation(current => current.map(lane => lane.id === laneId
            ? { ...lane, points: [...lane.points.filter(item => item.id !== point.id), point].sort((a,b) => a.position-b.position) }
            : lane));
        }
        continue;
      } else if (op.type === "DELETE_AUTOMATION") {
        const laneId = String(op.payload.laneId ?? op.targetId);
        const pointId = String(op.payload.pointId ?? "");
        setAutomation(current => current.map(lane => lane.id === laneId ? { ...lane, points: lane.points.filter(point => point.id !== pointId) } : lane));
        continue;
      } else if (op.type === "SET_EFFECT_PARAMETER") {
        if (op.targetId.startsWith("masterfx:")) {
          const effectId = op.targetId.slice(9);
          const key = String(op.payload.key);
          if (key === "masterOrder" && Array.isArray(op.payload.value)) {
            const order = op.payload.value.map(String);
            setMasterEffects(current => [...current].sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id)));
            continue;
          }
          setMasterEffects(current => current.map(effect => effect.id === effectId
            ? (key.startsWith("params.") ? { ...effect, params: { ...effect.params, [key.slice(7)]: op.payload.value } } : { ...effect, [key]: op.payload.value } as EffectInstance)
            : effect));
          if (key.startsWith("params.")) realAudioEngineRef.current?.setMasterParameter(effectId, key.slice(7), op.payload.value);
          if (key === "bypass") realAudioEngineRef.current?.setMasterBypass(effectId, Boolean(op.payload.value));
          continue;
        }
        const key = String(op.payload.key);
        setEffects(current => current.map(effect => {
          if (effect.id !== op.targetId) return effect;
          if (key.startsWith("params.")) return { ...effect, params: { ...effect.params, [key.slice(7)]: op.payload.value } };
          return { ...effect, [key]: op.payload.value } as EffectInstance;
        }));
      } else if (op.type === "ADD_EFFECT" && op.payload.effect) {
        const effect = op.payload.effect as EffectInstance;
        if (op.targetId.startsWith("masterfx:")) setMasterEffects(current => current.some(item => item.id === effect.id) ? current : [...current, effect]);
        else setEffects(current => current.some(item => item.id === effect.id) ? current : [...current, effect]);
      } else if (op.type === "REMOVE_EFFECT") {
        if (op.targetId.startsWith("masterfx:")) setMasterEffects(current => current.filter(effect => "masterfx:" + effect.id !== op.targetId));
        else setEffects(current => current.filter(effect => effect.id !== op.targetId));
      }
    }
  }, [events]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation") continue;
      const op=event.operation;
      if (op.type==="SET_MIXER_PARAMETER") setMixer(current=>current.map(ch=>ch.id===op.targetId ? {...ch,[String(op.payload.key)]:op.payload.value} : ch));
      if (op.type==="ADD_MIXER_CHANNEL" && op.payload.channel) setMixer(current=>current.some(ch=>ch.id===op.targetId)?current:[...current.filter(ch=>ch.id!=="master"),op.payload.channel as MixerChannel,current.find(ch=>ch.id==="master")!]);
    }
  },[events]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation") continue;
      const op = event.operation;
      if (op.type === "MIDI_NOTE_ON") {
        const note = Number(op.payload.note);
        setMidiHeld(prev => prev.includes(note) ? prev : [...prev, note]);
      } else if (op.type === "MIDI_NOTE_OFF") {
        const note = Number(op.payload.note);
        setMidiHeld(prev => prev.filter(n => n !== note));
      } else if (op.type === "SET_MIDI_CC") {
        setMidiCC(prev => [...prev.filter(cc => cc.controller !== Number(op.payload.controller)), { controller:Number(op.payload.controller), value:Number(op.payload.value), channel:Number(op.payload.channel) }].slice(-32));
      }
    }
  }, [events]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation" || event.operation.type !== "SET_SYNTH_PARAMETER") continue;
      const { path, value } = event.operation.payload;
      if (typeof path !== "string") continue;
      setSynth(current => {
        const next = structuredClone(current) as SynthState;
        const parts = path.split(".");
        let target: any = next;
        for (let i=0;i<parts.length-1;i++) target = target[parts[i]];
        target[parts[parts.length-1]] = value;
        return next;
      });
    }
  }, [events]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation" || event.operation.type !== "ADD_DRUM_SAMPLE") continue;
      const asset = event.operation.payload.asset as DrumAsset | undefined;
      if (asset && !drumAssets.some(item => item.id === asset.id)) setDrumAssets(current => [...current, asset]);
    }
  }, [events]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation") continue;
      const op = event.operation;
      if (op.type === "ADD_NOTE") {
        const note = op.payload as unknown as MidiNote;
        setPianoNotes(current => current.some(item => item.id === note.id) ? current : [...current, note]);
      } else if (op.type === "MOVE_NOTE") {
        const pitchDelta = Number(op.payload.pitchDelta ?? 0);
        const startDelta = Number(op.payload.startDelta ?? 0);
        const lengthDelta = Number(op.payload.lengthDelta ?? 0);
        setPianoNotes(current => current.map(note => note.id === op.targetId ? { ...note, pitch: Math.max(0, Math.min(127, note.pitch + pitchDelta)), start: Math.max(0, quantize(note.start + startDelta)), length: Math.max(pianoSnap, note.length + lengthDelta) } : note));
      } else if (op.type === "CHANGE_VELOCITY") {
        const velocity = Number(op.payload.velocity);
        setPianoNotes(current => current.map(note => note.id === op.targetId ? { ...note, velocity } : note));
      } else if (op.type === "DELETE_NOTE") {
        setPianoNotes(current => current.filter(note => note.id !== op.targetId));
        setSelectedNotes(current => current.filter(id => id !== op.targetId));
      }
    }
  }, [events, pianoSnap]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setBar(current => current >= 16 ? 1 : current + 1), 60000 / bpm / 2);
    return () => window.clearInterval(timer);
  }, [playing, bpm]);

  const online = presence.filter(user => user.status === "online");
  const currentUser = presence.find(user => user.actorId === userId) ?? null;

  function emit(type: Parameters<typeof publish>[0], targetId: string, payload: Record<string, unknown>, trackId?: string) {
    const projectOps = new Set(["MOVE_CLIP","PASTE_CLIP","DUPLICATE_CLIP","DELETE_CLIP","SPLIT_CLIP","ADD_TRACK","ADD_MARKER","CHANGE_PATTERN","UPDATE_DRUM_CHANNEL","ADD_PATTERN_CLIP","SET_SYNTH_PARAMETER","ADD_NOTE","MOVE_NOTE","CHANGE_VELOCITY","DELETE_NOTE","CHANGE_BPM","SET_MIXER_PARAMETER","ADD_MIXER_CHANNEL","SET_EFFECT_PARAMETER","ADD_EFFECT","REMOVE_EFFECT","SET_AUTOMATION","DELETE_AUTOMATION"]);
    const opId = crypto.randomUUID();
    if (projectOps.has(type)) {
      const before = cloneSnapshot(committedSnapshotRef.current ?? buildProjectSnapshot());
      pendingHistoryRef.current = { opId, type, before };
    }
    publish(type, targetId, { ...payload, opId }, trackId);
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

  type BrowserItem = { id:string; name:string; category:string; folder:string; kind:"sample"|"kit"|"preset"|"wavetable"|"instrument"|"effect"|"project"; previewUrl?:string; sourceAssetId?:string };
  const browserItems: BrowserItem[] = [
    ...drumAssets.map(asset => ({ id:"sample:"+asset.id, name:asset.name, category:"Samples", folder:asset.folder || asset.category, kind:"sample" as const, previewUrl:asset.previewUrl, sourceAssetId:asset.id })),
    ...DRUM_SAMPLES.map(name => ({ id:"builtin:"+name, name, category:"Samples", folder:"Built-in / Drums", kind:"sample" as const })),
    { id:"kit:factory", name:"Sorashi Factory Kit", category:"Drum Kits", folder:"Factory", kind:"kit" as const },
    { id:"kit:room", name:"Room Drum Kit", category:"Drum Kits", folder:"Current Room", kind:"kit" as const },
    { id:"preset:factory", name:"Factory Synth Presets", category:"Presets", folder:"Factory", kind:"preset" as const },
    { id:"wt:factory", name:"Factory Wavetables", category:"Wavetables", folder:"Factory", kind:"wavetable" as const },
    { id:"effect:factory", name:"Built-in Effect Library", category:"Effects", folder:"Built-in Effects", kind:"effect" as const },
    { id:"project:room", name:"Current Room Project", category:"Projects", folder:"Current Room", kind:"project" as const },
    ...Object.values(SYNTH_PRESETS).map((preset:any) => ({ id:"preset:"+preset.id, name:preset.name, category:"Presets", folder:"Synth Presets", kind:"preset" as const })),
    ...WAVETABLES.map((table:any) => ({ id:"wt:"+table.id, name:table.name, category:"Wavetables", folder:"Wavetables", kind:"wavetable" as const })),
    ...BUILT_IN_EFFECTS.map(effect => ({ id:"fx:"+effect.type, name:effect.name, category:"Effects", folder:"Built-in Effects", kind:"effect" as const })),
    { id:"instrument:sampler", name:"Sample Instrument", category:"Instruments", folder:"Factory", kind:"instrument" as const },
    { id:"instrument:synth", name:"Wavetable Synth", category:"Instruments", folder:"Factory", kind:"instrument" as const },
    { id:"project:current", name:"Current Beat", category:"Projects", folder:"Current Room", kind:"project" as const }
  ];

  const browserFolders = ["All", ...Array.from(new Set(browserItems.filter(item => item.category === browserCategory).map(item => item.folder)))];
  const filteredBrowserItems = browserItems.filter(item =>
    item.category === browserCategory &&
    (browserFolder === "All" || item.folder === browserFolder) &&
    item.name.toLowerCase().includes(browserSearch.toLowerCase())
  );

  function dragBrowserItem(event: React.DragEvent, item: BrowserItem) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-sorashi-browser-item", JSON.stringify(item));
  }

  function dropBrowserItem(event: React.DragEvent<HTMLDivElement>, trackId: string) {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/x-sorashi-browser-item");
    const legacyAssetId = event.dataTransfer.getData("application/x-sorashi-drum-asset");
    if (!raw && !legacyAssetId) return;
    let item: BrowserItem | null = null;
    if (raw) {
      try { item = JSON.parse(raw) as BrowserItem; } catch { return; }
    } else {
      const asset = drumAssets.find(entry => entry.id === legacyAssetId);
      if (asset) item = { id:"sample:"+asset.id, name:asset.name, category:"Samples", folder:asset.folder || asset.category, kind:"sample", previewUrl:asset.previewUrl, sourceAssetId:asset.id };
    }
    if (!item) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = Math.max(0, Math.round(((event.clientX - rect.left) / rect.width) * 32 / snap) * snap);
    const kind: ClipKind = item.kind === "sample" ? "audio" : item.kind === "pattern" ? "pattern" : item.kind === "loop" ? "loop" : "midi";
    const clip: Clip = { id:crypto.randomUUID(), name:item.name, kind, start, length:8, lane:0 };
    setTracks(current => current.map(track => track.id === trackId ? { ...track, clips:[...track.clips, clip] } : track));
    setSelectedClip(clip.id);
    emit(kind === "audio" ? "ADD_AUDIO_CLIP" : kind === "pattern" ? "ADD_PATTERN_CLIP" : kind === "loop" ? "ADD_LOOP_CLIP" : "ADD_MIDI_CLIP", clip.id, { ...clip, assetId:item.sourceAssetId, browserItemId:item.id }, trackId);
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

  async function uploadDrumSample(file: File) {
    if (!roomTicket || !chatId || !file.name.toLowerCase().endsWith(".wav")) return;
    const form = new FormData();
    form.append("file", file);
    form.append("category", assetCategory);
    form.append("folder", assetCategory);
    form.append("name", file.name.replace(/\\.wav$/i, ""));
    const response = await fetch("/api/room/assets?chatId=" + encodeURIComponent(String(chatId)) + "&ticket=" + encodeURIComponent(roomTicket), { method: "POST", body: form });
    if (!response.ok) return;
    const result = await response.json() as { asset: DrumAsset };
    setDrumAssets(current => [...current, result.asset]);
    emit("ADD_DRUM_SAMPLE", result.asset.id, { asset: result.asset }, "drums");
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

  function updateMixer(id:string, patch:Partial<MixerChannel>) {
    setMixer(current => current.map(ch => ch.id===id ? {...ch,...patch} : ch));
    for (const [key,value] of Object.entries(patch)) publish("SET_MIXER_PARAMETER", id, {key,value}, id);
  }
  function addMixerChannel(type:MixerChannel["type"]) {
    const id=crypto.randomUUID(); const name=type==="bus"?"New Bus":type==="group"?"New Group":"New Channel";
    const channel:MixerChannel={id,name,type,volume:0,pan:0,mute:false,solo:false,peak:-60,route:"master",inserts:[],sends:{}};
    setMixer(current=>[...current.filter(ch=>ch.id!=="master"),channel,current.find(ch=>ch.id==="master")!]);
    publish("ADD_MIXER_CHANNEL",id,{channel});
  }

  function emitMidi(type: "MIDI_NOTE_ON" | "MIDI_NOTE_OFF" | "SET_MIDI_CC", payload: Record<string, unknown>) {
    publish(type, "midi", payload, "midi");
  }
  function handleMidiMessage(data: Uint8Array) {
    const status = data[0] & 0xf0; const channel = (data[0] & 0x0f) + 1;
    if (channel !== midiChannel) return;
    const note = data[1]; const value = data[2];
    if (status === 0x90 && value > 0) { setMidiHeld(prev => prev.includes(note) ? prev : [...prev, note]); emitMidi("MIDI_NOTE_ON", { note, velocity:value, channel }); }
    else if (status === 0x80 || (status === 0x90 && value === 0)) { setMidiHeld(prev => prev.filter(n=>n!==note)); emitMidi("MIDI_NOTE_OFF", { note, channel }); }
    else if (status === 0xb0) { setMidiCC(prev => [...prev.filter(cc=>cc.controller!==note), {controller:note,value,channel}].slice(-32)); emitMidi("SET_MIDI_CC", { controller:note, value, channel }); }
  }
  function connectMidi() {
    if (!navigator.requestMIDIAccess) return;
    void navigator.requestMIDIAccess().then(access => {
      const names = Array.from(access.inputs.values()).map(input => input.name || "MIDI Input");
      setMidiInputs(names); setMidiEnabled(true);
      access.inputs.forEach(input => { input.onmidimessage = event => { if (event.data) handleMidiMessage(new Uint8Array(event.data)); }; });
    }).catch(() => setMidiEnabled(false));
  }

  function getEqBands(effect: EffectInstance): ParametricEqBand[] {
    if (effect.type !== "parametric-eq") return DEFAULT_EQ_BANDS;
    try { return JSON.parse(String(effect.params.bands ?? "[]")) as ParametricEqBand[]; } catch { return DEFAULT_EQ_BANDS; }
  }

  function updateEqBand(effectId: string, bandId: string, patch: Partial<ParametricEqBand>) {
    setEffects(current => current.map(effect => {
      if (effect.id !== effectId) return effect;
      const bands = getEqBands(effect).map(band => band.id === bandId ? { ...band, ...patch } : band);
      return { ...effect, params: { ...effect.params, bands: JSON.stringify(bands) } };
    }));
    const effect = effects.find(item => item.id === effectId);
    if (effect) {
      const bands = getEqBands(effect).map(band => band.id === bandId ? { ...band, ...patch } : band);
      publish("SET_EFFECT_PARAMETER", effectId, { key: "params.bands", value: JSON.stringify(bands) }, "master");
    }
  }

  function updateMasterEqBand(effectId: string, bandId: string, patch: Partial<ParametricEqBand>) {
    setMasterEffects(current => current.map(effect => {
      if (effect.id !== effectId) return effect;
      const bands = getEqBands(effect).map(band => band.id === bandId ? { ...band, ...patch } : band);
      return { ...effect, params: { ...effect.params, bands: JSON.stringify(bands) } };
    }));
    const effect = masterEffects.find(item => item.id === effectId);
    if (effect) {
      const bands = getEqBands(effect).map(band => band.id === bandId ? { ...band, ...patch } : band);
      audioFxRef.current?.setEffectParameter("master-channel", effectId, "bands", JSON.stringify(bands));
      publish("SET_EFFECT_PARAMETER", "masterfx:" + effectId, { key: "params.bands", value: JSON.stringify(bands) }, "master");
    }
  }

  function addMasterEffect(type: BuiltInEffectType) {
    const definition = BUILT_IN_EFFECTS.find(item => item.type === type);
    if (!definition) return;
    const effect: EffectInstance = { id: crypto.randomUUID(), type, name: definition.name, bypass: false, mix: 100, params: defaultEffectParams(type) };
    setMasterEffects(current => [...current, effect]);
    publish("ADD_EFFECT", "masterfx:" + effect.id, { effect }, "master");
  }

  function updateMasterEffect(id: string, patch: Partial<EffectInstance>) {
    setMasterEffects(current => current.map(effect => effect.id === id ? { ...effect, ...patch } : effect));
    for (const [key, value] of Object.entries(patch)) {
      publish("SET_EFFECT_PARAMETER", "masterfx:" + id, { key, value }, "master");
      if (key === "bypass") audioFxRef.current?.setEffectBypass("master-channel", id, Boolean(value));
    }
  }

  function updateMasterEffectParam(id: string, key: string, value: unknown) {
    setMasterEffects(current => current.map(effect => effect.id === id ? { ...effect, params: { ...effect.params, [key]: value } } : effect));
    audioFxRef.current?.setEffectParameter("master-channel", id, key, value);
    publish("SET_EFFECT_PARAMETER", "masterfx:" + id, { key: "params." + key, value }, "master");
  }

  function removeMasterEffect(id: string) {
    setMasterEffects(current => current.filter(effect => effect.id !== id));
    publish("REMOVE_EFFECT", "masterfx:" + id, {}, "master");
  }

  function moveMasterEffect(id: string, direction: -1 | 1) {
    setMasterEffects(current => {
      const index = current.findIndex(effect => effect.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      publish("SET_EFFECT_PARAMETER", "masterfx:" + id, { key: "masterOrder", value: copy.map(effect => effect.id) }, "master");
      return copy;
    });
  }

  async function testMasterChain() {
    if (!audioFxRef.current) audioFxRef.current = new AudioFxEngine();
    const engine = audioFxRef.current;
    await engine.resume();
    masterTestOscRef.current?.stop();
    const osc = engine.context.createOscillator();
    const gain = engine.context.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 110;
    gain.gain.setValueAtTime(0.0001, engine.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, engine.context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, engine.context.currentTime + 3);
    engine.disconnect("master-channel");
    engine.attachSource("master-channel", osc, masterEffects, engine.context.destination);
    masterTestOscRef.current = osc;
    osc.start();
    osc.stop(engine.context.currentTime + 3.05);
  }

  function addEffect(type: BuiltInEffectType) {
    const definition = BUILT_IN_EFFECTS.find(item => item.type === type);
    if (!definition) return;
    const effect: EffectInstance = { id: crypto.randomUUID(), type, name: definition.name, bypass: false, mix: 100, params: defaultEffectParams(type) };
    setEffects(current => [...current, effect]);
    publish("ADD_EFFECT", effect.id, { effect }, "master");
  }

  function updateEffect(id: string, patch: Partial<EffectInstance>) {
    setEffects(current => current.map(effect => effect.id === id ? { ...effect, ...patch } : effect));
    for (const [key, value] of Object.entries(patch)) publish("SET_EFFECT_PARAMETER", id, { key, value }, "master");
  }

  function updateEffectParam(id: string, key: string, value: unknown) {
    setEffects(current => current.map(effect => effect.id === id ? { ...effect, params: { ...effect.params, [key]: value } } : effect));
    publish("SET_EFFECT_PARAMETER", id, { key: "params."+key, value }, "master");
  }

  async function auditionEffects() {
    if (!audioFxRef.current) audioFxRef.current = new AudioFxEngine();
    const engine = audioFxRef.current;
    await engine.resume();
    const osc = engine.context.createOscillator();
    const gain = engine.context.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 110;
    gain.gain.setValueAtTime(0.0001, engine.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, engine.context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, engine.context.currentTime + 1.8);
    engine.attachSource("effects-audition", osc, effects, engine.context.destination);
    osc.start();
    osc.stop(engine.context.currentTime + 1.85);
  }

  function setSynthParameter(path: string, value: unknown) {
    setSynth(current => {
      const next = structuredClone(current) as SynthState;
      const parts = path.split(".");
      let target: any = next;
      for (let i=0;i<parts.length-1;i++) target = target[parts[i]];
      target[parts[parts.length-1]] = value;
      return next;
    });
    emit("SET_SYNTH_PARAMETER", path, { path, value }, "synth");
  }
  function updateSynthOsc(index: number, patch: Partial<SynthState["oscillators"][number]>) {
    setSynth(current => ({ ...current, oscillators: current.oscillators.map((osc,i)=>i===index ? {...osc,...patch}:osc) }));
    Object.entries(patch).forEach(([key,value]) => emit("SET_SYNTH_PARAMETER", "oscillators."+index+"."+key, { path:"oscillators."+index+"."+key, value }, "synth"));
  }

  function quantize(value: number) { return Math.max(0, Math.round(value / pianoSnap) * pianoSnap); }
  function addMidiNote(pitch: number, start: number) { const note: MidiNote = { id: crypto.randomUUID(), pitch, start: quantize(start), length: Math.max(pianoSnap, pianoSnap * 2), velocity: 100 }; setPianoNotes(current => [...current, note]); setSelectedNotes([note.id]); emit("ADD_NOTE", note.id, note, "keys"); }
  function selectMidiNote(id: string, additive: boolean) { setSelectedNotes(current => additive ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id]) : [id]); }
  function moveMidiNotes(dp: number, dt: number) { const ids = new Set(selectedNotes); setPianoNotes(current => current.map(n => ids.has(n.id) ? { ...n, pitch: Math.max(0, Math.min(127, n.pitch + dp)), start: quantize(n.start + dt) } : n)); selectedNotes.forEach(id => emit("MOVE_NOTE", id, { pitchDelta: dp, startDelta: dt }, "keys")); }
  function resizeMidiNotes(delta: number) { const ids = new Set(selectedNotes); setPianoNotes(current => current.map(n => ids.has(n.id) ? { ...n, length: Math.max(pianoSnap, quantize(n.length + delta)) } : n)); selectedNotes.forEach(id => emit("MOVE_NOTE", id, { lengthDelta: delta }, "keys")); }
  function changeMidiVelocity(value: number) { const ids = new Set(selectedNotes); setPianoNotes(current => current.map(n => ids.has(n.id) ? { ...n, velocity: value } : n)); selectedNotes.forEach(id => emit("CHANGE_VELOCITY", id, { velocity: value }, "keys")); }
  function deleteMidiNotes() { selectedNotes.forEach(id => emit("DELETE_NOTE", id, {}, "keys")); setPianoNotes(current => current.filter(n => !selectedNotes.includes(n.id))); setSelectedNotes([]); }
  function duplicateMidiNotes() { const copies = pianoNotes.filter(n => selectedNotes.includes(n.id)).map(n => ({ ...n, id: crypto.randomUUID(), start: quantize(n.start + n.length) })); setPianoNotes(current => [...current, ...copies]); setSelectedNotes(copies.map(n => n.id)); copies.forEach(note => emit("ADD_NOTE", note.id, note, "keys")); }
  function copyMidiNotes() { const data = pianoNotes.filter(n => selectedNotes.includes(n.id)); if (data.length) localStorage.setItem("sorashi-midi-clipboard", JSON.stringify(data)); }
  function pasteMidiNotes() { try { const data = JSON.parse(localStorage.getItem("sorashi-midi-clipboard") || "[]") as MidiNote[]; const copies = data.map(n => ({ ...n, id: crypto.randomUUID(), start: quantize(n.start + pianoSnap) })); setPianoNotes(current => [...current, ...copies]); setSelectedNotes(copies.map(n => n.id)); copies.forEach(note => emit("ADD_NOTE", note.id, note, "keys")); } catch {} }

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
  const exportProject: ExportProject = { bpm, durationBeats: Math.max(64, ...tracks.flatMap(track => track.clips.map(clip => clip.start + clip.length)), loopEndBeats), drumChannels, pianoNotes, tracks, mixer };
  const exportTargets = defaultExportTargets(exportProject);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function runExport(format: "wav" | "mp3" | "midi", targetId = exportTargetId) {
    const target = exportTargets.find(item => item.id === targetId);
    if (!target || exportBusy) return;
    setExportBusy(true);
    try {
      const safeName = target.label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export";
      if (format === "midi") downloadBlob(exportMidi(exportProject), safeName + ".mid");
      else if (format === "wav") downloadBlob(await renderWav(exportProject, target), safeName + ".wav");
      else {
        const mp3 = await exportMp3IfSupported(exportProject, target);
        if (mp3) downloadBlob(mp3, safeName + ".mp3");
        else downloadBlob(await renderWav(exportProject, target), safeName + ".wav");
      }
    } finally { setExportBusy(false); }
  }

  async function exportAllStems() {
    setExportBusy(true);
    try {
      for (const target of exportTargets.filter(item => item.id !== "master")) {
        const safeName = target.label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || target.id;
        downloadBlob(await renderWav(exportProject, target), safeName + "-stem.wav");
      }
    } finally { setExportBusy(false); }
  }

  async function sendCurrentExportToTelegram() {
    const target = exportTargets.find(item => item.id === exportTargetId);
    if (!target || !roomTicket || !chatId || exportBusy) return;
    setExportBusy(true);
    try {
      const blob = await renderWav(exportProject, target);
      const safeName = target.label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "export";
      const form = new FormData();
      form.set("file", new File([blob], safeName + ".wav", { type: "audio/wav" }));
      form.set("caption", "Sorashi DAW · " + target.label);
      const response = await fetch("/api/bot/export?chatId=" + encodeURIComponent(String(chatId)) + "&ticket=" + encodeURIComponent(roomTicket), { method: "POST", body: form });
      if (!response.ok) throw new Error("Telegram export failed");
    } finally { setExportBusy(false); }
  }


  return (
    <main className="daw">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">S</div><div><strong>SORASHI DAW</strong><span>shared beat room</span></div></div>
        <div className="project"><button className="project-name">Untitled Beat <span>⌄</span></button><span className="save-state"><i /> Saved</span><button className="history-button" onClick={() => setHistoryOpen(v => !v)}>HISTORY</button><button className="export-button" onClick={() => setExportOpen(v => !v)}>EXPORT</button></div>
        <div className="transport">
          <button className="transport-button" onClick={() => void togglePlayback()}>{playing ? "PAUSE" : "PLAY"}</button>
          <button className="transport-button" onClick={() => void publishStop()}>STOP</button>
          <button className="transport-icon" onClick={() => void publishStop()}>■</button>
          <span className="tempo-label">BPM</span>
          <input value={bpm} type="number" min="40" max="240" onChange={event => { const value = Number(event.target.value); setBpm(value); emit("CHANGE_BPM", "project", { bpm: value }); }} />
          <span className="position">{formatTransportTime(transportPosition, bpm)}</span><span className="position">BAR {bar} · BEAT {Math.floor(transportPosition % 4) + 1}</span><button className={"transport-loop " + (loopEnabled ? "active" : "")} onClick={() => { const next = !loopEnabled; setLoopEnabled(next); publishTransport({ playing:Boolean(transport?.playing), bpm, positionBeats:localTransportPosition(), startedAtServerMs:transport?.startedAtServerMs ?? 0, loopEnabled:next, loopStartBeats, loopEndBeats }); }}>LOOP</button>
          <span className={roomState === "live" ? "room-status live" : "room-status"}><i />{roomState === "live" ? "LIVE" : roomState.toUpperCase()}</span>
        </div>
      </header>

          {exportOpen && <div className="history-popover export-popover">
            <div className="history-head"><strong>EXPORT</strong><button onClick={() => setExportOpen(false)}>×</button></div>
            <div className="export-targets">
              {exportTargets.map(target => <button key={target.id} className={exportTargetId === target.id ? "active" : ""} onClick={() => setExportTargetId(target.id)}>{target.label}<small>{target.kind}</small></button>)}
            </div>
            <div className="export-actions">
              <button disabled={exportBusy} onClick={() => void runExport("wav")}>WAV</button>
              <button disabled={exportBusy} onClick={() => void runExport("mp3")}>MP3</button>
              <button disabled={exportBusy} onClick={() => void runExport("midi")}>MIDI</button>
              <button disabled={exportBusy} onClick={() => void exportAllStems()}>ALL STEMS · WAV</button><button disabled={exportBusy} onClick={() => void sendCurrentExportToTelegram()}>SEND TO CHAT</button>
            </div>
            <small className="export-note">{exportBusy ? "Rendering…" : "Master, channels and groups are rendered locally. MP3 uses the browser codec when available; otherwise WAV is produced."}</small>
          </div>}

          {historyOpen && <div className="history-popover">
            <div className="history-head"><strong>VERSION HISTORY</strong><button onClick={() => setHistoryOpen(false)}>×</button></div>
            <div className="history-list">
              {projectHistory.slice().reverse().map(item => <div className="history-item" key={item.version}>
                <div><b>{item.label}</b><small>{new Date(item.createdAt).toLocaleString()}</small></div>
                <button onClick={async () => { if (await restoreProjectVersion(item.version)) { const refreshed = await getProjectHistory(); setProjectHistory(refreshed); setHistoryOpen(false); } }}>RESTORE</button>
              </div>)}
              {projectHistory.length === 0 && <div className="history-empty">No saved versions yet.</div>}
            </div>
          </div>

      <div className="toolbar">
        <div className="tool-tabs">{windows.map(windowName => <button key={windowName} className={active === windowName ? "tool-tab active" : "tool-tab"} onClick={() => setActive(windowName)}>{icon(windowName)} {windowName}</button>)}</div>
        <div className="toolbar-right">
          <span>4/4</span><span>{tracks.length * 16} bars</span>
          <label>Snap <select value={snap} onChange={event => { const value = Number(event.target.value); setSnap(value); emit("SET_GRID", "project", { snap: value }); }}><option value={1}>1/16</option><option value={2}>1/8</option><option value={4}>1/4</option><option value={8}>1/2</option></select></label>
          <label>Zoom <input className="zoom-input" type="range" min="0.7" max="2" step="0.1" value={zoom} onChange={event => { const value = Number(event.target.value); setZoom(value); emit("SET_ZOOM", "playlist", { zoom: value }); }} /></label>
        </div>
      </div>

      <div className="main-layout">
        <aside className="left-dock browser-dock">
          <DockHeader title="BROWSER / LIBRARY" action="+" />
          <div className="browser-search"><span>⌕</span><input value={browserSearch} onChange={event => setBrowserSearch(event.target.value)} placeholder="Search library" /></div>
          <div className="browser-categories">{["Samples","Drum Kits","Presets","Wavetables","Instruments","Effects","Projects"].map(category => <button key={category} className={browserCategory === category ? "active" : ""} onClick={() => { setBrowserCategory(category); setBrowserFolder("All"); }}>{category}</button>)}</div>
          <div className="browser-folders"><span>FOLDERS</span>{browserFolders.map(folder => <button key={folder} className={browserFolder === folder ? "active" : ""} onClick={() => setBrowserFolder(folder)}>› {folder}</button>)}</div>
          <div className="browser-library-list">
            {filteredBrowserItems.map(item => <div key={item.id} className="browser-item" draggable onDragStart={event => dragBrowserItem(event, item)}>
              <span className="browser-item-icon">{item.kind === "sample" ? "♪" : item.kind === "preset" ? "◈" : item.kind === "wavetable" ? "∿" : item.kind === "effect" ? "ƒx" : item.kind === "instrument" ? "⌁" : item.kind === "project" ? "▣" : "◆"}</span>
              <div className="browser-item-main"><b>{item.name}</b><small>{item.folder}</small></div>
              {item.previewUrl ? <audio controls preload="none" src={item.previewUrl} onClick={event => event.stopPropagation()} /> : item.kind === "sample" ? <span className="preview-button" title="Preview unavailable for built-in item">▶</span> : null}
            </div>)}
            {!filteredBrowserItems.length && <div className="browser-empty">Nothing found</div>}
          </div>
          <div className="browser-hint">DRAG ITEM → PLAYLIST / PROJECT</div>
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
                <div className="clip-lane" onDoubleClick={() => addClip("midi")} onDragOver={event => { if (event.dataTransfer.types.includes("application/x-sorashi-browser-item") || event.dataTransfer.types.includes("application/x-sorashi-drum-asset")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={event => dropBrowserItem(event, track.id)}>
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
                <div className="automation-targets">
                  {automation.map(lane => <button key={lane.id} className={lane.id === activeAutomationLane ? "active" : ""} onClick={() => setActiveAutomationLane(lane.id)}>{lane.label}</button>)}
                </div>
                {automation.filter(lane => lane.id === activeAutomationLane).map(lane => <div key={lane.id} className="automation-canvas" onDoubleClick={event => addAutomationPoint(event, lane)}>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                    <polyline points={lane.points.map(point => point.position + "," + (100 - point.value)).join(" ")} />
                  </svg>
                  {lane.points.map(point => <button key={point.id} className="automation-point" style={{ left: point.position + "%", bottom: point.value + "%" }} onDoubleClick={event => { event.stopPropagation(); publish("DELETE_AUTOMATION", lane.id, { laneId: lane.id, pointId: point.id }); setAutomation(current => current.map(item => item.id === lane.id ? { ...item, points: item.points.filter(p => p.id !== point.id) } : item)); }} />)}
                </div>)}
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
<div className="drum-grid"><div className="drum-head"><span>CHANNEL</span><span>SAMPLE</span><span>VOL</span><span>PAN</span><span>M/S</span><span>VELOCITY</span><span>STEPS</span></div>{drumChannels.map(channel => <div className="drum-row" key={channel.id} onDragOver={event => event.preventDefault()} onDrop={event => { const id = event.dataTransfer.getData("application/x-sorashi-drum-asset"); const asset = drumAssets.find(item => item.id === id); if (asset) updateDrumChannel(channel.id, { sample: asset.name, sampleId: asset.id }); }}><div className="drum-channel"><span className="channel-led" /><strong>{channel.name}</strong></div><select value={channel.sampleId ? "asset:" + channel.sampleId : channel.sample} onChange={event => {
  const value = event.target.value;
  if (value.startsWith("asset:")) {
    const asset = drumAssets.find(item => item.id === value.slice(6));
    if (asset) updateDrumChannel(channel.id, { sample: asset.name, sampleId: asset.id });
  } else updateDrumChannel(channel.id, { sample: value, sampleId: undefined });
}}><optgroup label="Built-in">{DRUM_SAMPLES.map(sample => <option key={sample} value={sample}>{sample}</option>)}</optgroup><optgroup label="Room Drum Kit">{drumAssets.map(asset => <option key={asset.id} value={"asset:" + asset.id}>{asset.name}</option>)}</optgroup></select><input className="mini-number" value={channel.volume} type="number" min="-60" max="6" onChange={event => updateDrumChannel(channel.id, { volume: Number(event.target.value) })}/><input className="mini-pan" value={channel.pan} type="range" min="-100" max="100" onChange={event => updateDrumChannel(channel.id, { pan: Number(event.target.value) })}/><div className="ms"><button className={channel.mute ? "on" : ""} onClick={() => updateDrumChannel(channel.id, { mute: !channel.mute })}>M</button><button className={channel.solo ? "on" : ""} onClick={() => updateDrumChannel(channel.id, { solo: !channel.solo })}>S</button></div><input className="velocity" value={channel.velocity} type="range" min="1" max="127" onChange={event => updateDrumChannel(channel.id, { velocity: Number(event.target.value) })}/><div className="steps">{Array.from({ length: patternLength }, (_, index) => <button key={index} className={channel.steps[index] ? "step on" : "step"} onClick={() => toggleDrumStep(channel.id, index)} />)}</div></div>)}</div><div className="panel-footer"><span>{drumChannels[0]?.steps.slice(0, patternLength).filter(Boolean).length ?? 0} kick hits</span><span>{patternLength} steps · {activePattern}</span></div>
            </Panel>
            <Panel title="Wavetable Synth" subtitle="3 oscillators · modulation matrix" className="synth-panel">
<div className="synth-toolbar"><div>{["OSC","FILTER","ENV","LFO","MOD","PRESETS"].map(tab=><button className={synthTab===tab?"active":""} key={tab} onClick={()=>setSynthTab(tab)}>{tab}</button>)}</div><span>POLY {synth.polyphony}</span><span>MASTER {synth.masterVolume} dB</span></div>
<div className="synth-main">
{(synthTab==="OSC" || synthTab==="FILTER" || synthTab==="ENV") && <div className="synth-oscillators">{synth.oscillators.map((osc,i)=><div className="osc-card" key={osc.id}><div className="osc-head"><b>OSC {i+1}</b><button className={osc.enabled?"active":""} onClick={()=>updateSynthOsc(i,{enabled:!osc.enabled})}>ON</button></div><select value={osc.type} onChange={e=>updateSynthOsc(i,{type:e.target.value as any})}>{["wavetable","sine","triangle","saw","square"].map(t=><option key={t}>{t}</option>)}</select><select value={osc.wavetableId} onChange={e=>updateSynthOsc(i,{wavetableId:e.target.value})}>{WAVETABLES.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><label>WT POS<input type="range" min="0" max="100" value={osc.wavetablePosition} onChange={e=>updateSynthOsc(i,{wavetablePosition:Number(e.target.value)})}/><b>{osc.wavetablePosition}</b></label><div className="synth-grid-controls"><Knob label="VOL" /><Knob label="DETUNE" /><Knob label="PHASE" /></div><div className="synth-number-row"><label>OCT <input type="number" value={osc.octave} onChange={e=>updateSynthOsc(i,{octave:Number(e.target.value)})}/></label><label>SEMI <input type="number" value={osc.semitone} onChange={e=>updateSynthOsc(i,{semitone:Number(e.target.value)})}/></label><label>FINE <input type="number" value={osc.fine} onChange={e=>updateSynthOsc(i,{fine:Number(e.target.value)})}/></label><label>UNI <input type="number" min="1" max="16" value={osc.unison} onChange={e=>updateSynthOsc(i,{unison:Number(e.target.value)})}/></label></div></div>)}</div>}
{(synthTab==="FILTER" || synthTab==="OSC") && <div className="synth-section"><h4>FILTER</h4><select value={synth.filter.type} onChange={e=>setSynthParameter("filter.type",e.target.value)}>{["lowpass","highpass","bandpass","notch"].map(t=><option key={t}>{t}</option>)}</select><label>CUTOFF <input type="range" min="20" max="20000" value={synth.filter.cutoff} onChange={e=>setSynthParameter("filter.cutoff",Number(e.target.value))}/><b>{synth.filter.cutoff} Hz</b></label><label>RESONANCE <input type="range" min="0" max="100" value={synth.filter.resonance} onChange={e=>setSynthParameter("filter.resonance",Number(e.target.value))}/></label></div>}
{(synthTab==="ENV" || synthTab==="OSC") && <div className="synth-section"><h4>AMP ADSR</h4><div className="adsr"><Knob label="ATTACK"/><Knob label="DECAY"/><Knob label="SUSTAIN"/><Knob label="RELEASE"/></div><h4>FILTER ADSR</h4><div className="adsr"><Knob label="ATTACK"/><Knob label="DECAY"/><Knob label="SUSTAIN"/><Knob label="RELEASE"/></div></div>}
{(synthTab==="LFO" || synthTab==="MOD") && <div className="synth-section"><h4>LFO</h4>{synth.lfos.map((lfo,i)=><div className="lfo-row" key={lfo.id}><b>LFO {i+1}</b><select value={lfo.shape} onChange={e=>setSynthParameter("lfos."+i+".shape",e.target.value)}>{["sine","triangle","saw","square"].map(s=><option key={s}>{s}</option>)}</select><input type="range" min=".1" max="20" step=".1" value={lfo.rate} onChange={e=>setSynthParameter("lfos."+i+".rate",Number(e.target.value))}/><span>{lfo.rate} Hz</span></div>)}</div>}
{(synthTab==="MOD" || synthTab==="OSC") && <div className="synth-section modulation"><h4>MODULATION MATRIX</h4>{synth.routes.map((route,i)=><div className="mod-route" key={route.id}><select value={route.source} onChange={e=>setSynthParameter("routes."+i+".source",e.target.value)}><option>LFO 1</option><option>LFO 2</option><option>ENV 1</option><option>ENV 2</option><option>Velocity</option><option>Keytrack</option><option>Mod Wheel</option></select><span>→</span><select value={route.destination} onChange={e=>setSynthParameter("routes."+i+".destination",e.target.value)}><option>Pitch</option><option>Volume</option><option>Filter Cutoff</option><option>Filter Resonance</option><option>Wavetable Position</option><option>Pan</option></select><input type="range" min="-100" max="100" value={route.amount} onChange={e=>setSynthParameter("routes."+i+".amount",Number(e.target.value))}/><b>{route.amount}</b></div>)}</div>}
{(synthTab==="PRESETS") && <div className="synth-section preset-list"><h4>PRESETS</h4>{SYNTH_PRESETS.length ? SYNTH_PRESETS.map(p=><button key={p.id}>{p.name}</button>) : <div className="empty-room">Preset library ready for expansion</div>}</div>}
</div>
<div className="synth-noise"><label><input type="checkbox" checked={synth.noise.enabled} onChange={e=>setSynthParameter("noise.enabled",e.target.checked)}/> NOISE</label><span>VOL {synth.noise.volume} dB</span><input type="range" min="-60" max="0" value={synth.noise.volume} onChange={e=>setSynthParameter("noise.volume",Number(e.target.value))}/><span>COLOR {synth.noise.color}</span><input type="range" min="0" max="100" value={synth.noise.color} onChange={e=>setSynthParameter("noise.color",Number(e.target.value))}/></div>
</Panel>
            <Panel title="MIDI Engine" subtitle={midiEnabled ? "Browser MIDI · live" : "Browser MIDI · ready"} className="midi-panel">
<div className="midi-toolbar"><button className={midiEnabled?"active":""} onClick={connectMidi}>{midiEnabled?"MIDI CONNECTED":"ENABLE MIDI"}</button><label>CHANNEL <select value={midiChannel} onChange={e=>setMidiChannel(Number(e.target.value))}>{Array.from({length:16},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label><span>{midiInputs.length ? midiInputs.join(", ") : "No MIDI device selected"}</span></div>
<div className="midi-content"><div className="midi-keyboard">{Array.from({length:24},(_,i)=>i+48).map(note=><button key={note} className={midiHeld.includes(note)?"held":""} onMouseDown={()=>{setMidiHeld(prev=>prev.includes(note)?prev:[...prev,note]);emitMidi("MIDI_NOTE_ON",{note,velocity:100,channel:midiChannel})}} onMouseUp={()=>{setMidiHeld(prev=>prev.filter(n=>n!==note));emitMidi("MIDI_NOTE_OFF",{note,channel:midiChannel})}}>{["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][note%12]}{Math.floor(note/12)-1}</button>)}</div><div className="midi-monitor"><div><b>HELD NOTES</b><span>{midiHeld.length ? midiHeld.map(n=>n+"").join(" · ") : "—"}</span></div><div><b>CC</b><span>{midiCC.length ? midiCC.slice(-6).map(cc=>"CC"+cc.controller+" "+cc.value).join(" · ") : "—"}</span></div><div><b>INPUTS</b><span>{midiInputs.length ? midiInputs.join(" · ") : "Browser Web MIDI unavailable or not connected"}</span></div></div></div>
</Panel>
            <Panel title="Piano Roll" subtitle="MIDI · C minor" className="piano-panel">
  <div className="piano-toolbar"><div className="piano-tools"><button onClick={deleteMidiNotes}>Delete</button><button onClick={copyMidiNotes}>Copy</button><button onClick={pasteMidiNotes}>Paste</button><button onClick={duplicateMidiNotes}>Duplicate</button></div><label>Snap <select value={pianoSnap} onChange={event => setPianoSnap(Number(event.target.value))}><option value={0.25}>1/16</option><option value={0.5}>1/8</option><option value={1}>1/4</option><option value={2}>1/2</option></select></label><label>Scale <select value={scaleRoot} onChange={event => setScaleRoot(Number(event.target.value))}>{["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"].map((n,i)=><option key={n} value={i}>{n}</option>)}</select><select value={scaleMode} onChange={event => setScaleMode(event.target.value)}><option value="minor">minor</option><option value="major">major</option></select></label><label>Zoom <input type="range" min="0.6" max="2.5" step="0.1" value={pianoZoom} onChange={event => setPianoZoom(Number(event.target.value))}/></label></div>
  <div className="piano-editor" style={{ "--piano-zoom": pianoZoom } as React.CSSProperties}>
    <div className="piano-keyboard">{Array.from({length: 24},(_,i)=>{const pitch=83-i; return <button key={pitch} className={pitch%12===scaleRoot ? "scale-key" : ""}>{["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][pitch%12]}{pitch}</button>})}</div>
    <div className="piano-scroll"><div className="piano-timeline">{Array.from({length:32},(_,i)=><span key={i}>{i+1}</span>)}</div>
      <div className="piano-grid">{Array.from({length:24},(_,r)=>{const pitch=83-r; return <div className={"piano-row "+(pitch%12===scaleRoot ? "scale-row" : "")} key={pitch}><div className="piano-cells">{Array.from({length:32},(_,col)=><button key={col} className="piano-cell" onClick={()=>addMidiNote(pitch,col)} />)}</div></div>})}
      {pianoNotes.map(note=><button key={note.id} className={"midi-note "+(selectedNotes.includes(note.id)?"selected":"")} style={{left:(note.start/32*100)+"%",top:((83-note.pitch)*22)+"px",width:Math.max(1,note.length/32*100)+"%",opacity:0.35+note.velocity/180}} onClick={event=>{event.stopPropagation();selectMidiNote(note.id,event.shiftKey)}} title={"Pitch "+note.pitch+" · Velocity "+note.velocity}>{note.pitch}</button>)}</div>
    </div>
  </div>
  <div className="velocity-editor"><span>Velocity</span>{selectedNotes.length>0 && <input type="range" min="1" max="127" value={pianoNotes.find(n=>n.id===selectedNotes[0])?.velocity ?? 100} onChange={event=>changeMidiVelocity(Number(event.target.value))}/>}</div>
  <div className="piano-actions"><button onClick={()=>moveMidiNotes(1,0)}>Pitch +</button><button onClick={()=>moveMidiNotes(-1,0)}>Pitch −</button><button onClick={()=>moveMidiNotes(0,pianoSnap)}>Move →</button><button onClick={()=>resizeMidiNotes(pianoSnap)}>Length +</button><button onClick={()=>resizeMidiNotes(-pianoSnap)}>Length −</button></div>
</Panel>
          </div>
        </section>

        <aside className="right-dock">
          <DockHeader title="ROOM" action={online.length + " online"} />
          <div className="room-users">{online.map(user => <div className="room-user" key={user.actorId}><span className="user-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.firstName)}</span><div><strong>{user.username ? "@" + user.username : user.firstName}</strong><small>{user.area}</small></div><i className="online-dot" /></div>)}{online.length === 0 && <div className="empty-room">Waiting for collaborators…</div>}</div>
          <DockHeader title="INSPECTOR" action="Reset" />
          <div className="inspector"><div className="inspector-title"><span className="track-icon">D</span><div><strong>{selected?.name ?? "Drums"}</strong><small>{selected ? selected.kind.toUpperCase() : "Shared channel"}</small></div></div>{["Volume", "Pan", "Filter", "Send A"].map((name, index) => <div className="control" key={name}><span>{name}</span><div className="control-line"><i style={{ width: (72 - index * 11) + "%" }} /></div><b>{index === 0 ? "0.0 dB" : index === 1 ? "C" : index === 2 ? "42%" : "-18 dB"}</b></div>)}</div>
          <DockHeader title="SYNTH" action="Poly" /><div className="mini-synth"><div className="waveform" aria-label="Synth waveform"><svg viewBox="0 0 320 48" preserveAspectRatio="none"><path d="M0 25 C12 8 20 39 32 24 S52 9 64 25 S84 41 96 24 S116 7 128 25 S148 43 160 24 S180 9 192 25 S212 40 224 24 S244 7 256 25 S276 42 288 24 S308 10 320 25" /><path className="waveform-secondary" d="M0 27 C16 20 24 31 40 24 S64 18 80 25 S104 32 120 24 S144 18 160 25 S184 32 200 24 S224 18 240 25 S264 32 280 24 S304 18 320 25" /></svg><span>WAVETABLE · OSC 1</span></div><div className="knobs"><Knob label="Cutoff" /><Knob label="Res" /><Knob label="Attack" /><Knob label="Release" /></div></div>
        </aside>
      </div>

      <Panel title="Mixer" subtitle="channels · buses · groups · sends · master" className="full-mixer-panel">
<div className="mixer-toolbar"><button onClick={()=>addMixerChannel("channel")}>+ CHANNEL</button><button onClick={()=>addMixerChannel("bus")}>+ BUS</button><button onClick={()=>addMixerChannel("group")}>+ GROUP</button><button onClick={()=>addMixerChannel("send")}>+ SEND</button><span>{mixer.length} strips</span></div>
<div className="full-mixer">{mixer.map(ch=><div className={"mixer-strip "+ch.type} key={ch.id}><div className="strip-head"><b>{ch.name}</b><small>{ch.type}</small></div><div className="meter"><i style={{height:Math.max(3,Math.min(100,(60+ch.peak)*1.5))+"%"}}/></div><input className="fader" type="range" min="-60" max="6" step=".1" value={ch.volume} onChange={e=>updateMixer(ch.id,{volume:Number(e.target.value)})}/><div className="strip-db">{ch.volume.toFixed(1)} dB</div><input type="range" min="-100" max="100" value={ch.pan} onChange={e=>updateMixer(ch.id,{pan:Number(e.target.value)})}/><div className="strip-buttons"><button className={ch.mute?"on":""} onClick={()=>updateMixer(ch.id,{mute:!ch.mute})}>M</button><button className={ch.solo?"on":""} onClick={()=>updateMixer(ch.id,{solo:!ch.solo})}>S</button></div><select value={ch.route} onChange={e=>updateMixer(ch.id,{route:e.target.value})}>{mixer.filter(x=>x.type==="bus"||x.type==="master").map(x=><option key={x.id}>{x.name}</option>)}</select><div className="insert-list">{ch.inserts.map((fx,i)=><button key={i} onClick={()=>{const inserts=ch.inserts.filter((_,j)=>j!==i);updateMixer(ch.id,{inserts})}}>{fx} ×</button>)}<button onClick={()=>updateMixer(ch.id,{inserts:[...ch.inserts,"EQ"]})}>+ FX</button></div><div className="send-list">{Object.entries(ch.sends).map(([send,value])=><label key={send}>{send}<input type="range" min="-60" max="0" value={value} onChange={e=>updateMixer(ch.id,{sends:{...ch.sends,[send]:Number(e.target.value)}})}/></label>)}</div></div>)}</div>
</Panel>
<Panel title="Master Channel" subtitle="master insert chain · signal meter" className="master-channel-panel">
  <div className="master-channel-head">
    <div><b>MASTER</b><span>{masterEffects.length} inserts · signal path</span></div>
    <button onClick={()=>void testMasterChain()}>▶ TEST MASTER</button>
  </div>
  <div className="master-meter-row">
    <div className="master-meter"><i style={{height:(Number.isFinite(masterMeter)?Math.max(0,Math.min(100,(masterMeter+60)/60*100)):0)+"%"}} /></div>
    <div><b>{Number.isFinite(masterMeter)?masterMeter.toFixed(1):"-∞"} dBFS</b><span>MASTER LEVEL</span></div>
  </div>
  <div className="master-browser">{["parametric-eq","compressor","saturation","reverb","limiter"].map(type=>{const item=BUILT_IN_EFFECTS.find(effect=>effect.type===type); return item ? <button key={type} onClick={()=>addMasterEffect(type as BuiltInEffectType)}>+ {item.name}</button> : null;})}</div>
  <div className="master-rack">{masterEffects.map((effect,index)=><div className={"master-effect "+(effect.bypass?"bypassed":"")} key={effect.id}>
    <div className="effect-head"><b>{index+1}. {effect.name}</b><span>{effect.type}</span><button onClick={()=>updateMasterEffect(effect.id,{bypass:!effect.bypass})}>{effect.bypass?"BYP":"ON"}</button><button onClick={()=>moveMasterEffect(effect.id,-1)}>↑</button><button onClick={()=>moveMasterEffect(effect.id,1)}>↓</button><button onClick={()=>removeMasterEffect(effect.id)}>×</button></div>
    {effect.type==="parametric-eq" ? <div className="master-eq-bands">{getEqBands(effect).map((band,index)=><div className="master-eq-band" key={band.id}><b>{index+1}</b><label>FREQ<input type="number" min="20" max="20000" value={Math.round(band.frequency)} onChange={e=>updateMasterEqBand(effect.id,band.id,{frequency:Number(e.target.value)})}/></label><label>GAIN<input type="number" min="-24" max="24" step=".1" value={band.gain} onChange={e=>updateMasterEqBand(effect.id,band.id,{gain:Number(e.target.value)})}/></label><label>Q<input type="number" min=".05" max="30" step=".01" value={band.q} onChange={e=>updateMasterEqBand(effect.id,band.id,{q:Number(e.target.value)})}/></label></div>)}</div> : <div className="effect-params">{Object.entries(effect.params).filter(([,value])=>typeof value==="number").map(([key,value])=><label key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><input type="range" min={key==="threshold"||key==="makeup"?-60:key==="ratio"?1:key==="attack"||key==="release"?0:0} max={key==="threshold"?0:key==="ratio"?20:key==="attack"||key==="release"?1:key==="makeup"?24:100} step={key==="ratio"?0.1:key==="attack"||key==="release"?0.001:0.1} value={Number(value)} onChange={e=>updateMasterEffectParam(effect.id,key,Number(e.target.value))}/><b>{Number(value).toFixed(2)}</b></label>)}</div>}
  </div>)}</div>
</Panel>
<Panel title="Effects" subtitle="real-time Web Audio processing · shared rack" className="effects-panel">
  <div className="effects-toolbar"><button onClick={()=>{setEqAnalyzing(true);void auditionEffects()}}>▶ TEST AUDIO</button><span>{effects.length} inserts · Web Audio DSP</span></div>
  <div className="effect-browser">{BUILT_IN_EFFECTS.map(item=><button key={item.type} onClick={()=>addEffect(item.type)}>{item.name}</button>)}</div>
  {effects.filter(effect=>effect.type==="parametric-eq").map(effect=><div className="eq-editor" key={effect.id}>
    <div className="eq-head"><div><b>PARAMETRIC EQ</b><small>6 bands · frequency / gain / Q / filter type</small></div><button onClick={()=>updateEffect(effect.id,{bypass:!effect.bypass})}>{effect.bypass?"BYP":"ON"}</button></div>
    <canvas ref={eqCanvasRef} className="eq-spectrum" width={900} height={220} />
    <div className="eq-band-list">{getEqBands(effect).map((band,index)=><div className="eq-band" key={band.id}>
      <b>{index+1}</b><select value={band.type} onChange={e=>updateEqBand(effect.id,band.id,{type:e.target.value as BiquadFilterType})}><option value="lowshelf">Low Shelf</option><option value="highpass">High Pass</option><option value="peaking">Bell</option><option value="notch">Notch</option><option value="lowpass">Low Pass</option><option value="highshelf">High Shelf</option></select>
      <label>FREQ<input type="number" min="20" max="20000" value={Math.round(band.frequency)} onChange={e=>updateEqBand(effect.id,band.id,{frequency:Number(e.target.value)})}/></label>
      <label>GAIN<input type="number" min="-24" max="24" step=".1" value={band.gain} onChange={e=>updateEqBand(effect.id,band.id,{gain:Number(e.target.value)})}/></label>
      <label>Q<input type="number" min=".05" max="30" step=".01" value={band.q} onChange={e=>updateEqBand(effect.id,band.id,{q:Number(e.target.value)})}/></label>
      <button className={band.enabled?"on":""} onClick={()=>updateEqBand(effect.id,band.id,{enabled:!band.enabled})}>{band.enabled?"ON":"OFF"}</button>
    </div>)}</div>
  </div>)}
  <div className="effect-rack">{effects.filter(effect=>effect.type!=="parametric-eq").map(effect=><div className={"effect-card "+(effect.bypass?"bypassed":"")} key={effect.id}>
    <div className="effect-head"><b>{effect.name}</b><span>{effect.type}</span><button onClick={()=>updateEffect(effect.id,{bypass:!effect.bypass})}>{effect.bypass?"BYP":"ON"}</button><button onClick={()=>{setEffects(current=>current.filter(item=>item.id!==effect.id));publish("REMOVE_EFFECT",effect.id,{}, "master")}}>×</button></div>
    {effect.type==="compressor" && <div className="compressor-meter"><div className="gr-meter"><i style={{height:Math.min(100,Math.max(0,Math.abs(gainReduction[effect.id] ?? 0)/30*100))+"%"}} /></div><div><b>{(gainReduction[effect.id] ?? 0).toFixed(1)} dB</b><span>GAIN REDUCTION</span></div></div>}
    <div className="effect-params">{Object.entries(effect.params).filter(([,value])=>typeof value==="number").map(([key,value])=><label key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><input type="range" min={key==="threshold"||key==="makeup"?-60:key==="ratio"?1:key==="attack"||key==="release"?0:-60} max={key==="threshold"?0:key==="ratio"?20:key==="attack"||key==="release"?1:key==="makeup"?24:100} step={key==="ratio"?0.1:key==="attack"||key==="release"?0.001:0.1} value={Number(value)} onChange={event=>updateEffectParam(effect.id,key,Number(event.target.value))}/><b>{Number(value).toFixed(2)}</b></label>)}</div>
  </div>)}</div>
</Panel>
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
function formatTransportTime(beats: number, bpm: number) { const seconds = Math.max(0, beats * 60 / Math.max(1, bpm)); const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); const ms = Math.floor((seconds % 1) * 1000); return String(mins).padStart(2,"0") + ":" + String(secs).padStart(2,"0") + "." + String(ms).padStart(3,"0"); }
function initials(name: string) { return name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function icon(windowName: WindowName) { return ({ Playlist: "▤", "Step Sequencer": "▦", "Piano Roll": "⌁", Mixer: "▥", Browser: "⌕", Synthesizer: "◉", Effects: "✦" } as Record<WindowName, string>)[windowName]; }  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.operation" || (event.operation.type !== "UNDO_PATCH" && event.operation.type !== "REDO_PATCH")) continue;
      const changes = event.operation.payload.changes as SnapshotChange[] | undefined;
      if (!Array.isArray(changes) || !changes.length) continue;
      const direction = event.operation.type === "UNDO_PATCH" ? "undo" : "redo";
      const current = buildProjectSnapshot();
      applyProjectSnapshot(applySnapshotChanges(current, changes, direction));
    }
  }, [events]);

  useEffect(() => {
    for (const event of events) {
      if (event.type !== "sync.project.restore" || !event.state || typeof event.state !== "object") continue;
      applyProjectSnapshot(event.state);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoDepth(0);
      setRedoDepth(0);
    }
  }, [events]);


