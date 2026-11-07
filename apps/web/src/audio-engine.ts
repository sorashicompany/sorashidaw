import type { EffectInstance } from "../../../packages/shared/src/effects";
import type { DrumChannel, MidiNote } from "./audio-engine-types";
import { AudioFxEngine } from "./audio-fx";

export class RealAudioEngine {
  readonly context: AudioContext;
  private node: AudioWorkletNode | null = null;
  private masterFx: AudioFxEngine | null = null;
  private masterEffects: EffectInstance[] = [];
  private loaded = false;
  private masterGain: GainNode | null = null;
  private masterPan: StereoPannerNode | null = null;

  constructor() { this.context = new AudioContext(); }

  async init(): Promise<void> {
    if (this.loaded) return;
    await this.context.audioWorklet.addModule("/audio-engine-processor.js");
    this.node = new AudioWorkletNode(this.context, "sorashi-audio-engine", { outputChannelCount: [2] });
    this.node.port.onmessage = event => {
      if (event.data?.type === "bar") this.onBar?.(Number(event.data.bar));
    };
    this.loaded = true;
  }

  onBar?: (bar: number) => void;

  async resume(): Promise<void> {
    await this.init();
    if (this.context.state !== "running") await this.context.resume();
  }

  setState(bpm: number, channels: DrumChannel[], notes: MidiNote[]): void {
    this.node?.port.postMessage({ type: "state", bpm, channels: channels.map(({ id,name,steps,velocity,mute,solo,volume }) => ({ id,name,steps,velocity,mute,solo,volume })), notes });
  }

  async setMasterChain(effects: EffectInstance[]): Promise<void> {
    await this.resume();
    if (!this.node) return;
    if (this.masterFx) {
      this.masterFx.disconnect("master-channel");
    }
    this.masterEffects = structuredClone(effects);
    this.masterFx = new AudioFxEngine(this.context);
    this.masterGain?.disconnect();
    this.masterPan?.disconnect();
    this.masterGain = this.context.createGain();
    this.masterPan = this.context.createStereoPanner();
    this.masterGain.connect(this.masterPan).connect(this.context.destination);
    this.masterFx.attachSource("master-channel", this.node, this.masterEffects, this.masterGain);
  }

  setMasterParameter(effectId: string, key: string, value: unknown): void {
    this.masterFx?.setEffectParameter("master-channel", effectId, key, value);
  }

  setMasterBypass(effectId: string, bypass: boolean): void {
    this.masterFx?.setEffectBypass("master-channel", effectId, bypass);
  }

  async setPlaying(playing: boolean, bpm: number, positionBeats = 0): Promise<void> {
    await this.resume();
    this.node?.port.postMessage({ type: "transport", playing, bpm, positionBeats, startAtFrame: 0 });
  }

  async scheduleTransport(
    playing: boolean,
    bpm: number,
    startAtAudioTime: number,
    positionBeats: number,
    loopEnabled: boolean,
    loopStartBeats: number,
    loopEndBeats: number,
  ): Promise<void> {
    await this.resume();
    const delaySeconds = Math.max(0, startAtAudioTime - this.context.currentTime);
    this.node?.port.postMessage({
      type: "transport",
      playing,
      bpm,
      positionBeats,
      loopEnabled,
      loopStartBeats,
      loopEndBeats,
      startDelaySeconds: delaySeconds,
    });
  }

  stop(): void {
    this.node?.port.postMessage({ type: "transport", playing: false, bpm: 128 });
  }

  seek(step = 0): void {
    this.node?.port.postMessage({ type: "seek", step });
  }
  setAutomationValue(target: string, parameter: string, value: number): void {
    if (target === "volume") {
      this.masterGain?.gain.setTargetAtTime(Math.pow(10, (value - 100) * 0.6 / 20), this.context.currentTime, 0.012);
      return;
    }
    if (target === "pan") {
      this.masterPan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, value / 100)), this.context.currentTime, 0.012);
      return;
    }
    if (target === "effect.parameter" || target === "master.parameter") {
      const separator = parameter.indexOf(".");
      if (separator > 0) this.masterFx?.setEffectParameter("master-channel", parameter.slice(0, separator), parameter.slice(separator + 1), value);
      return;
    }
    this.node?.port.postMessage({ type: "automation", target, parameter, value });
  }
}
