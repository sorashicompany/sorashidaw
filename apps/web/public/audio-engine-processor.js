class SorashiAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.playing = false;
    this.bpm = 128;
    this.step = 0;
    this.nextStepFrame = 0;\n    this.startAtFrame = 0;\n    this.positionBeats = 0;\n    this.loopEnabled = false;\n    this.loopStartBeats = 0;\n    this.loopEndBeats = 64;
    this.channels = [];
    this.notes = [];
    this.voices = [];
    this.port.onmessage = event => {
      const message = event.data;
      if (message.type === "transport") {
        this.bpm = Math.max(40, Math.min(240, Number(message.bpm) || 128));
        this.positionBeats = Number(message.positionBeats || 0);\n        this.loopEnabled = Boolean(message.loopEnabled);\n        this.loopStartBeats = Number(message.loopStartBeats || 0);\n        this.loopEndBeats = Math.max(this.loopStartBeats + 1, Number(message.loopEndBeats || 64));
        this.startAtFrame = Number(message.startAtFrame || currentFrame);
        this.playing = !message.startAtFrame && Boolean(message.playing);
        if (message.startAtFrame && message.playing) this.playing = false;
        if (this.playing) {
          this.step = Math.floor(this.positionBeats * 4);
          this.nextStepFrame = currentFrame;
        }
        if (!message.playing) this.voices.length = 0;
      }
      if (message.type === "state") {
        this.channels = message.channels || [];
        this.notes = message.notes || [];
        this.bpm = Math.max(40, Math.min(240, Number(message.bpm) || 128));
      }
      if (message.type === "seek") {
        this.step = Math.max(0, Number(message.step) || 0);
        this.nextStepFrame = currentFrame;
      }
    };
  }

  trigger(channel, velocity) {
    const name = String(channel.name || "").toLowerCase();
    const v = Math.max(0.01, Math.min(1, Number(velocity || channel.velocity || 100) / 127));
    if (name.includes("kick") || name.includes("808")) {
      this.voices.push({ type: "kick", age: 0, amp: v * (name.includes("808") ? 0.45 : 0.7) });
    } else if (name.includes("snare") || name.includes("clap")) {
      this.voices.push({ type: "noise", age: 0, amp: v * (name.includes("clap") ? 0.22 : 0.32) });
    } else if (name.includes("hat")) {
      this.voices.push({ type: "hat", age: 0, amp: v * 0.16 });
    } else {
      this.voices.push({ type: "perc", age: 0, amp: v * 0.18 });
    }
  }

  renderVoice(voice, sampleRate) {
    const t = voice.age / sampleRate;
    voice.age++;
    if (voice.type === "kick") {
      const f = 48 + 105 * Math.exp(-t * 22);
      return Math.sin(2 * Math.PI * f * t) * voice.amp * Math.exp(-t * 7);
    }
    if (voice.type === "noise" || voice.type === "hat") {
      const noise = (Math.random() * 2 - 1);
      const decay = voice.type === "hat" ? 48 : 18;
      return noise * voice.amp * Math.exp(-t * decay);
    }
    return Math.sin(2 * Math.PI * 220 * t) * voice.amp * Math.exp(-t * 22);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const sr = sampleRate;
    const framesPerStep = sr * 60 / this.bpm / 4;

    for (let i = 0; i < out[0].length; i++) {
      const frame = currentFrame + i;
      if (this.playing && frame >= this.nextStepFrame) {
        const step = this.step % 64;
        for (const channel of this.channels) {
          const steps = Array.isArray(channel.steps) ? channel.steps : [];
          if (steps[step % Math.max(1, steps.length)]) this.trigger(channel, channel.velocity);
        }
        for (const note of this.notes) {
          const start = Number(note.start || 0);
          if (Math.abs(start - step) < 0.01) {
            const freq = 440 * Math.pow(2, (Number(note.pitch || 60) - 69) / 12);
            this.voices.push({ type: "tone", age: 0, amp: Math.max(0.01, Number(note.velocity || 100) / 127 * 0.12), freq, release: Math.max(0.05, Number(note.length || 1) * 60 / this.bpm / 4) });
          }
        }
        this.step++;\n        this.positionBeats = this.step / 4;\n        if (this.loopEnabled && this.positionBeats >= this.loopEndBeats) { this.step = Math.floor(this.loopStartBeats * 4); this.positionBeats = this.loopStartBeats; }
        this.nextStepFrame += framesPerStep;
        if (this.step % 16 === 0) this.port.postMessage({ type: "bar", bar: Math.floor(this.step / 16) + 1 });
      }

      let sample = 0;
      for (let v = this.voices.length - 1; v >= 0; v--) {
        const voice = this.voices[v];
        let value = 0;
        if (voice.type === "tone") {
          const t = voice.age / sr;
          value = Math.sin(2 * Math.PI * voice.freq * t) * voice.amp * Math.min(1, t * 100) * Math.exp(-t / voice.release);
          voice.age++;
          if (t > voice.release * 5) this.voices.splice(v, 1);
        } else {
          value = this.renderVoice(voice, sr);
          const limit = voice.type === "kick" ? 1.2 : voice.type === "hat" ? 0.22 : 0.4;
          if (voice.age > sr * limit) this.voices.splice(v, 1);
        }
        sample += value;
      }
      sample = Math.max(-0.92, Math.min(0.92, sample));
      out[0][i] = sample;
      if (out[1]) out[1][i] = sample;
    }
    return true;
  }
}
registerProcessor("sorashi-audio-engine", SorashiAudioProcessor);
