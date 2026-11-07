export type BuiltInEffectType =
  | "parametric-eq" | "compressor" | "limiter" | "reverb" | "delay"
  | "saturation" | "distortion" | "chorus" | "phaser" | "flanger"
  | "filter" | "gain" | "stereo-widener" | "utility";

export type EffectParameterValue = number | boolean | string;
export type EffectInstance = {
  id: string;
  type: BuiltInEffectType;
  name: string;
  bypass: boolean;
  mix: number;
  params: Record<string, EffectParameterValue>;
};

export const BUILT_IN_EFFECTS: Array<{type: BuiltInEffectType; name: string; category: string}> = [
  {type:"parametric-eq",name:"Parametric EQ",category:"EQ"},
  {type:"compressor",name:"Compressor",category:"Dynamics"},
  {type:"limiter",name:"Limiter",category:"Dynamics"},
  {type:"reverb",name:"Reverb",category:"Time"},
  {type:"delay",name:"Delay",category:"Time"},
  {type:"saturation",name:"Saturation",category:"Color"},
  {type:"distortion",name:"Distortion",category:"Color"},
  {type:"chorus",name:"Chorus",category:"Modulation"},
  {type:"phaser",name:"Phaser",category:"Modulation"},
  {type:"flanger",name:"Flanger",category:"Modulation"},
  {type:"filter",name:"Filter",category:"Filter"},
  {type:"gain",name:"Gain",category:"Utility"},
  {type:"stereo-widener",name:"Stereo Widener",category:"Stereo"},
  {type:"utility",name:"Utility",category:"Utility"},
];

export function defaultEffectParams(type: BuiltInEffectType): Record<string, EffectParameterValue> {
  switch (type) {
    case "parametric-eq": return {lowGain:0, lowFreq:120, midGain:0, midFreq:1200, midQ:1, highGain:0, highFreq:8000};
    case "compressor": return {threshold:-18, ratio:4, attack:0.01, release:0.15, knee:12, makeup:0};
    case "limiter": return {threshold:-1, release:0.08, makeup:0};
    case "reverb": return {decay:2.2, preDelay:0.02, damping:55};
    case "delay": return {time:0.28, feedback:35, tone:6500};
    case "saturation": return {drive:18};
    case "distortion": return {drive:35, tone:4500};
    case "chorus": return {rate:1.2, depth:0.004, delay:0.025, feedback:8};
    case "phaser": return {rate:0.35, depth:0.7, feedback:55, stages:4};
    case "flanger": return {rate:0.18, depth:0.003, delay:0.004, feedback:55};
    case "filter": return {type:"lowpass", cutoff:9000, resonance:0.2};
    case "gain": return {gain:0};
    case "stereo-widener": return {width:1};
    case "utility": return {gain:0, pan:0, phaseInvert:false};
  }
}
