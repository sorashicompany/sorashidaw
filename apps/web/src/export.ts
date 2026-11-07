export type ExportTarget = {
  id: string;
  label: string;
  kind: "master" | "track" | "group";
  trackIds?: string[];
  mixerIds?: string[];
};

export type ExportProject = {
  bpm: number;
  durationBeats: number;
  drumChannels: Array<{ id: string; name: string; steps: boolean[]; velocity: number; mute?: boolean; solo?: boolean; volume?: number }>;
  pianoNotes: Array<{ pitch: number; start: number; length: number; velocity: number }>;
  tracks: Array<{ id: string; name: string; clips: Array<{ kind: string; start: number; length: number; assetId?: string }> }>;
  mixer: Array<{ id: string; name: string; type: string; volume: number; mute?: boolean; solo?: boolean; route?: string; busId?: string }>;
};

export function defaultExportTargets(project: ExportProject): ExportTarget[] {
  const targets: ExportTarget[] = [{ id: "master", label: "Master", kind: "master" }];
  const tracks = project.tracks.map(track => ({ id: "track:" + track.id, label: track.name, kind: "track" as const, trackIds: [track.id] }));
  const groups = project.mixer.filter(channel => channel.type === "group" || channel.type === "bus").map(channel => ({
    id: "mixer:" + channel.id, label: channel.name, kind: "group" as const, mixerIds: [channel.id]
  }));
  return [...targets, ...tracks, ...groups];
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

export async function renderWav(project: ExportProject, target: ExportTarget): Promise<Blob> {
  const sampleRate = 44100;
  const durationBeats = Math.max(4, project.durationBeats || 64);
  const durationSeconds = durationBeats * 60 / Math.max(1, project.bpm);
  const context = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
  const master = context.createGain();
  master.gain.value = 0.72;
  master.connect(context.destination);

  const allowedTrackIds = new Set(target.trackIds ?? []);
  const isMaster = target.kind === "master";
  const mixerById = new Map(project.mixer.map(item => [item.id, item]));
  const targetMixerId = target.mixerIds?.[0];
  const targetMixer = targetMixerId ? mixerById.get(targetMixerId) : undefined;
  const shouldRenderTrack = (trackId: string) => {
    if (isMaster) return true;
    if (target.kind === "track") return allowedTrackIds.has(trackId);
    if (!targetMixerId) return false;
    if (trackId === targetMixerId) return true;
    const mixer = mixerById.get(trackId);
    return mixer?.busId === targetMixerId || mixer?.route === targetMixerId || mixer?.route === targetMixer?.name;
  };

  const scheduleTone = (pitch: number, startBeat: number, lengthBeat: number, velocity: number, destination: AudioNode) => {
    const start = startBeat * 60 / project.bpm;
    const duration = Math.max(0.025, lengthBeat * 60 / project.bpm / 4);
    if (start >= durationSeconds) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    const amp = clamp(velocity / 127, 0.01, 1) * 0.12;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(amp, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, Math.min(durationSeconds, start + duration));
    osc.connect(gain).connect(destination);
    osc.start(start);
    osc.stop(Math.min(durationSeconds, start + duration + 0.02));
  };

  const scheduleDrum = (name: string, startBeat: number, velocity: number, destination: AudioNode) => {
    const start = startBeat * 60 / project.bpm;
    if (start >= durationSeconds) return;
    const gain = context.createGain();
    const osc = context.createOscillator();
    const amp = clamp(velocity / 127, 0.01, 1) * 0.32;
    gain.gain.setValueAtTime(amp, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, Math.min(durationSeconds, start + (name.toLowerCase().includes("hat") ? 0.09 : 0.35)));
    if (name.toLowerCase().includes("kick") || name.toLowerCase().includes("808")) {
      osc.type = "sine";
      osc.frequency.setValueAtTime(name.toLowerCase().includes("808") ? 55 : 48, start);
      osc.frequency.exponentialRampToValueAtTime(42, Math.min(durationSeconds, start + 0.16));
      osc.connect(gain).connect(destination);
      osc.start(start); osc.stop(Math.min(durationSeconds, start + 0.4));
    } else {
      osc.type = "square";
      osc.frequency.value = name.toLowerCase().includes("snare") || name.toLowerCase().includes("clap") ? 180 : 4200;
      const noise = context.createBufferSource();
      const buffer = context.createBuffer(1, Math.ceil(sampleRate * 0.2), sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;
      noise.connect(gain).connect(destination);
      noise.start(start); noise.stop(Math.min(durationSeconds, start + 0.2));
    }
  };

  const trackGain = (trackId: string) => {
    const mixer = mixerById.get(trackId);
    const db = mixer?.volume ?? 0;
    const gain = context.createGain();
    gain.gain.value = Math.pow(10, db / 20);
    gain.connect(master);
    return gain;
  };

  for (const track of project.tracks) {
    if (!shouldRenderTrack(track.id)) continue;
    const destination = trackGain(track.id);
    const lower = track.name.toLowerCase();
    const isDrumTrack = track.id === "drums" || lower.includes("drum");
    if (isDrumTrack) {
      for (const channel of project.drumChannels) {
        if (channel.mute) continue;
        channel.steps.forEach((enabled, index) => {
          if (!enabled) return;
          for (let beat = index; beat < durationBeats; beat += 4) scheduleDrum(channel.name, beat, channel.velocity, destination);
        });
      }
    }
    if (!isDrumTrack) {
      for (const note of project.pianoNotes) {
        if (note.start < durationBeats) scheduleTone(note.pitch, note.start, note.length, note.velocity, destination);
      }
    }
    for (const clip of track.clips) {
      if (clip.kind === "audio" && clip.assetId) {
        // Asset WAV decoding is intentionally kept client-side. If the asset is available,
        // the caller may preload/decode it and add it to a future render graph.
        void clip.assetId;
      }
    }
  }


  const rendered = await context.startRendering();
  return audioBufferToWav(rendered);
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = clamp(buffer.getChannelData(ch)[i], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([output], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

export function exportMidi(project: ExportProject): Blob {
  const ppq = 480;
  const tracks: Uint8Array[] = [];
  const tempo = Math.round(60000000 / Math.max(1, project.bpm));
  tracks.push(midiTrack([
    metaTempo(tempo), metaText("Sorashi DAW"),
    noteEvents(project.pianoNotes, ppq, 0),
    endOfTrack()
  ].flat()));
  for (const channel of project.drumChannels) {
    const events: number[] = [0, 0xff, 0x03, channel.name.length, ...Array.from(new TextEncoder().encode(channel.name))];
    channel.steps.forEach((enabled, index) => {
      if (!enabled) return;
      events.push(...midiNoteOn(0, 36 + project.drumChannels.indexOf(channel), channel.velocity));
      events.push(...midiNoteOff(ppq, 36 + project.drumChannels.indexOf(channel)));
    });
    events.push(...endOfTrack());
    tracks.push(midiTrack(events));
  }
  const header = new Uint8Array(14);
  writeAsciiBytes(header, 0, "MThd");
  setU32(header, 4, 6); setU16(header, 8, 1); setU16(header, 10, tracks.length); setU16(header, 12, ppq);
  const body = tracks.flatMap(track => Array.from(track));
  return new Blob([header, new Uint8Array(body)], { type: "audio/midi" });
}

function noteEvents(notes: ExportProject["pianoNotes"], ppq: number, channel: number): number[] {
  const events: Array<{ tick:number; data:number[] }> = [];
  for (const note of notes) {
    events.push({ tick: Math.round(note.start * ppq), data: [0x90 | channel, note.pitch & 127, clamp(note.velocity, 1, 127)] });
    events.push({ tick: Math.round((note.start + note.length) * ppq), data: [0x80 | channel, note.pitch & 127, 0] });
  }
  events.sort((a,b)=>a.tick-b.tick);
  let previous = 0; const out: number[] = [];
  for (const event of events) { out.push(...vlq(event.tick - previous), ...event.data); previous = event.tick; }
  return out;
}
function midiNoteOn(delta:number,note:number,velocity:number){ return [...vlq(delta),0x99,note & 127,velocity & 127]; }
function midiNoteOff(delta:number,note:number){ return [...vlq(delta),0x89,note & 127,0]; }
function metaTempo(usPerQuarter:number){ return [0,0xff,0x51,3,(usPerQuarter>>16)&255,(usPerQuarter>>8)&255,usPerQuarter&255]; }
function metaText(text:string){ const bytes=Array.from(new TextEncoder().encode(text)); return [0,0xff,0x01,...vlq(bytes.length),...bytes]; }
function endOfTrack(){ return [0,0xff,0x2f,0]; }
function midiTrack(events:number[]): Uint8Array { const data=new Uint8Array(events); const out=new Uint8Array(8+data.length); writeAsciiBytes(out,0,"MTrk"); setU32(out,4,data.length); out.set(data,8); return out; }
function vlq(value:number){ let buffer=value & 0x7f; const bytes=[buffer]; while(value>>=7){ buffer=(value & 0x7f)|0x80; bytes.unshift(buffer); } return bytes; }
function writeAsciiBytes(target:Uint8Array, offset:number, value:string){ for(let i=0;i<value.length;i++) target[offset+i]=value.charCodeAt(i); }
function setU16(target:Uint8Array, offset:number, value:number){ target[offset]=(value>>8)&255; target[offset+1]=value&255; }
function setU32(target:Uint8Array, offset:number, value:number){ target[offset]=(value>>>24)&255; target[offset+1]=(value>>>16)&255; target[offset+2]=(value>>>8)&255; target[offset+3]=value&255; }

export async function exportMp3IfSupported(project: ExportProject, target: ExportTarget): Promise<Blob | null> {
  const mime = ["audio/mpeg", "audio/mp3"].find(type => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
  if (!mime) return null;
  const wav = await renderWav(project, target);
  const arrayBuffer = await wav.arrayBuffer();
  const audioContext = new AudioContext();
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const destination = audioContext.createMediaStreamDestination();
  const recorder = new MediaRecorder(destination.stream, { mimeType: mime });
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
  recorder.start();
  const source = audioContext.createBufferSource();
  source.buffer = decoded; source.connect(destination);
  source.onended = () => recorder.stop();
  source.start();
  await stopped;
  await audioContext.close();
  return new Blob(chunks, { type: mime });
}
