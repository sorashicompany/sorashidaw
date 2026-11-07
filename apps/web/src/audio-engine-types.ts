export type DrumChannel = { id:string; name:string; steps:boolean[]; velocity:number; mute:boolean; solo:boolean; volume:number };
export type MidiNote = { id:string; pitch:number; start:number; length:number; velocity:number; selected?:boolean };
