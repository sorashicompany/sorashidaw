export type SynthOscillatorType = "wavetable" | "sine" | "triangle" | "saw" | "square";
export type SynthModSource = "LFO 1" | "LFO 2" | "ENV 1" | "ENV 2" | "Velocity" | "Keytrack" | "Mod Wheel";
export type SynthModDestination = "Pitch" | "Volume" | "Filter Cutoff" | "Filter Resonance" | "Wavetable Position" | "Pan";
export type WavetableDefinition = { id: string; name: string; category: string; frames: number; };
export type SynthPreset = { id: string; name: string; category: string; description?: string; state: SynthState; };
export type SynthOscillator = { id: string; enabled: boolean; type: SynthOscillatorType; wavetableId: string; wavetablePosition: number; volume: number; octave: number; semitone: number; fine: number; unison: number; detune: number; phase: number; };
export type SynthEnvelope = { attack: number; decay: number; sustain: number; release: number; };
export type SynthLfo = { id: string; rate: number; shape: "sine" | "triangle" | "saw" | "square"; sync: boolean; amount: number; };
export type SynthFilter = { type: "lowpass" | "highpass" | "bandpass" | "notch"; cutoff: number; resonance: number; drive: number; };
export type SynthModRoute = { id: string; source: SynthModSource; destination: SynthModDestination; amount: number; };
export type SynthState = { polyphony: number; glide: number; masterVolume: number; oscillators: SynthOscillator[]; noise: { enabled: boolean; volume: number; color: number }; filter: SynthFilter; ampEnv: SynthEnvelope; filterEnv: SynthEnvelope; lfos: SynthLfo[]; routes: SynthModRoute[]; };
export const WAVETABLES: WavetableDefinition[] = [
  { id: "basic-shapes", name: "Basic Shapes", category: "Analog", frames: 64 },
  { id: "spectral", name: "Spectral", category: "Digital", frames: 128 },
  { id: "vocal", name: "Vocal Formant", category: "Formant", frames: 96 },
  { id: "metal", name: "Metallic", category: "Digital", frames: 128 },
];
export const SYNTH_PRESETS: SynthPreset[] = [];
export const OSCILLATOR_TYPES: SynthOscillatorType[] = ["wavetable", "sine", "triangle", "saw", "square"];
export const MODULATION_SOURCES: SynthModSource[] = ["LFO 1", "LFO 2", "ENV 1", "ENV 2", "Velocity", "Keytrack", "Mod Wheel"];
export const MODULATION_DESTINATIONS: SynthModDestination[] = ["Pitch", "Volume", "Filter Cutoff", "Filter Resonance", "Wavetable Position", "Pan"];
