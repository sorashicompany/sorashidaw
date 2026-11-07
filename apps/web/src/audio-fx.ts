import type { BuiltInEffectType, EffectInstance } from "../../../packages/shared/src/effects";

type EffectNode = { effectId?: string; input: AudioNode; output: AudioNode; analyzer?: AnalyserNode; reduction?: DynamicsCompressorNode; dispose: () => void; setParameter: (key:string,value:unknown) => void };

const db = (value:number) => Math.pow(10, value / 20);
const clamp = (v:number,min:number,max:number) => Math.max(min,Math.min(max,v));

function makeCurve(amount:number): Float32Array {
  const n=2048, curve=new Float32Array(n), k=Math.max(0.01,amount);
  for(let i=0;i<n;i++){ const x=i*2/n-1; curve[i]=Math.tanh(x*(1+k*8))/Math.tanh(1+k*8); }
  return curve;
}

function connectChain(nodes: AudioNode[]): void { for(let i=0;i<nodes.length-1;i++) nodes[i].connect(nodes[i+1]); }

export class AudioFxEngine {
  readonly context: AudioContext;
  private chains = new Map<string, EffectNode[]>();

  constructor() { this.context = new AudioContext(); }

  async resume(): Promise<void> { if(this.context.state !== "running") await this.context.resume(); }

  createEffect(effect: EffectInstance): EffectNode {
    const c=this.context, p=effect.params, wet=clamp(Number(effect.mix ?? 100)/100,0,1);
    const input=c.createGain(), output=c.createGain();
    const dry=c.createGain(), wetGain=c.createGain();
    dry.gain.value=1-wet; wetGain.gain.value=wet;
    input.connect(dry); dry.connect(output);
    let processor: AudioNode=input;
    let eqFilters: BiquadFilterNode[] = [];\n    let reductionNode: DynamicsCompressorNode | undefined;
    wetGain.connect(output);

    const bypass=()=>{ dry.gain.value=effect.bypass?1:1-wet; wetGain.gain.value=effect.bypass?0:wet; };
    const param=(key:string,value:unknown)=>{
      const v=Number(value);
      switch(effect.type){
        case "gain": if(key==="gain") (processor as GainNode).gain.value=db(v); break;
        case "filter": if(key==="cutoff") (processor as BiquadFilterNode).frequency.value=clamp(v,20,20000); if(key==="resonance")(processor as BiquadFilterNode).Q.value=clamp(v,0.0001,30); break;
        case "compressor": {
          const n=processor as DynamicsCompressorNode;
          if(key==="threshold")n.threshold.value=clamp(v,-100,0); if(key==="ratio")n.ratio.value=clamp(v,1,20); if(key==="attack")n.attack.value=clamp(v,0,1); if(key==="release")n.release.value=clamp(v,0,1); if(key==="knee")n.knee.value=clamp(v,0,40); if(key==="makeup") output.gain.value=db(v);
          break;
        }
        case "limiter": { const n=processor as DynamicsCompressorNode; if(key==="threshold")n.threshold.value=clamp(v,-20,0); if(key==="release")n.release.value=clamp(v,0,1); if(key==="makeup")output.gain.value=db(v); break; }
        case "delay": { const n=processor as DelayNode; if(key==="time")n.delayTime.value=clamp(v,0,1); break; }
        case "saturation": case "distortion": { const n=processor as WaveShaperNode; if(key==="drive")n.curve=makeCurve(v/100); break; }
        case "chorus": case "flanger": case "phaser": { /* modulation parameters are handled by the LFO graph */ break; }
        case "stereo-widener": { if(key==="width"){ const split=processor as ChannelSplitterNode; void split; } break; }
      }
    };

    switch(effect.type){
      case "parametric-eq": {
        let bands: Array<{id:string;frequency:number;gain:number;q:number;type:BiquadFilterType;enabled:boolean}> = [];
        try { bands = JSON.parse(String(p.bands ?? "[]")); } catch { bands = []; }
        if (!bands.length) bands = [
          {id:"eq1",frequency:80,gain:0,q:.71,type:"lowshelf",enabled:true},
          {id:"eq2",frequency:180,gain:0,q:1,type:"peaking",enabled:true},
          {id:"eq3",frequency:500,gain:0,q:1,type:"peaking",enabled:true},
          {id:"eq4",frequency:1200,gain:0,q:1,type:"peaking",enabled:true},
          {id:"eq5",frequency:3500,gain:0,q:1,type:"peaking",enabled:true},
          {id:"eq6",frequency:9000,gain:0,q:.71,type:"highshelf",enabled:true}
        ];
        eqFilters = bands.map(b => { const f=c.createBiquadFilter(); f.type=b.type; f.frequency.value=clamp(b.frequency,20,20000); f.gain.value=clamp(b.gain,-24,24); f.Q.value=clamp(b.q,.05,30); f.enabled=b.enabled; return f; });
        connectChain([input,...eqFilters,wetGain]); processor=eqFilters[0] ?? input;
        break;
      }
      case "compressor": {
        const n=c.createDynamicsCompressor(); n.threshold.value=clamp(Number(p.threshold??-18),-100,0); n.ratio.value=clamp(Number(p.ratio??4),1,20); n.attack.value=clamp(Number(p.attack??.01),0,1); n.release.value=clamp(Number(p.release??.15),0,1); n.knee.value=clamp(Number(p.knee??12),0,40); output.gain.value=db(Number(p.makeup??0)); input.connect(n); n.connect(wetGain); reductionNode=n; processor=n; break;
      }
      case "limiter": {
        const n=c.createDynamicsCompressor(); n.threshold.value=Number(p.threshold??-1); n.ratio.value=20; n.attack.value=.001; n.release.value=Number(p.release??.08); n.knee.value=0; input.connect(n); n.connect(wetGain); processor=n; break;
      }
      case "reverb": {
        const con=c.createConvolver(), ir=c.createBuffer(2,c.sampleRate*Math.max(.1,Number(p.decay??2.2)),c.sampleRate);
        const decay=Number(p.decay??2.2), damp=clamp(Number(p.damping??55),0,100)/100;
        for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<d.length;i++){const t=i/c.sampleRate;d[i]=(Math.random()*2-1)*Math.pow(1-t/decay,2)*(1-damp*t/decay);}}
        con.buffer=ir; input.connect(con); con.connect(wetGain); processor=con; break;
      }
      case "delay": {
        const n=c.createDelay(1), fb=c.createGain(), tone=c.createBiquadFilter();
        n.delayTime.value=Number(p.time??.28); fb.gain.value=clamp(Number(p.feedback??35)/100,0,.95); tone.type="lowpass"; tone.frequency.value=Number(p.tone??6500);
        input.connect(n); n.connect(tone); tone.connect(fb); fb.connect(n); n.connect(wetGain); processor=n; break;
      }
      case "saturation": case "distortion": {
        const n=c.createWaveShaper(); n.oversample="4x"; n.curve=makeCurve(Number(p.drive??30)/100); input.connect(n); n.connect(wetGain); processor=n; break;
      }
      case "chorus": {
        const d=c.createDelay(.1), lfo=c.createOscillator(), depth=c.createGain(), mix=c.createGain();
        d.delayTime.value=Number(p.delay??.025); depth.gain.value=Number(p.depth??.004); lfo.frequency.value=Number(p.rate??1.2);
        lfo.connect(depth); depth.connect(d.delayTime); input.connect(d); d.connect(wetGain); lfo.start(); processor=d;
        return {input,output,dispose:()=>lfo.stop(),setParameter:param};
      }
      case "flanger": {
        const d=c.createDelay(.05), lfo=c.createOscillator(), depth=c.createGain(), fb=c.createGain();
        d.delayTime.value=Number(p.delay??.004); depth.gain.value=Number(p.depth??.003); fb.gain.value=clamp(Number(p.feedback??55)/100,-.95,.95); lfo.frequency.value=Number(p.rate??.18);
        lfo.connect(depth); depth.connect(d.delayTime); input.connect(d); d.connect(fb); fb.connect(d); d.connect(wetGain); lfo.start(); processor=d;
        return {input,output,dispose:()=>lfo.stop(),setParameter:param};
      }
      case "phaser": {
        const filters: BiquadFilterNode[]=[]; const count=Math.max(2,Math.min(8,Number(p.stages??4)));
        for(let i=0;i<count;i++){const f=c.createBiquadFilter();f.type="allpass";f.frequency.value=600+i*700;filters.push(f);}
        const lfo=c.createOscillator(), depth=c.createGain(), fb=c.createGain(); lfo.frequency.value=Number(p.rate??.35); depth.gain.value=Number(p.depth??.7)*1000; fb.gain.value=clamp(Number(p.feedback??55)/100,-.95,.95);
        connectChain([input,...filters,wetGain]); lfo.connect(depth); filters.forEach(f=>depth.connect(f.frequency)); filters.at(-1)!.connect(fb); fb.connect(filters[0]); lfo.start(); processor=filters[0];
        return {input,output,dispose:()=>lfo.stop(),setParameter:param};
      }
      case "filter": { const n=c.createBiquadFilter(); n.type=String(p.type??"lowpass") as BiquadFilterType; n.frequency.value=Number(p.cutoff??9000); n.Q.value=Number(p.resonance??.2); input.connect(n); n.connect(wetGain); processor=n; break; }
      case "gain": { const n=c.createGain(); n.gain.value=db(Number(p.gain??0)); input.connect(n); n.connect(wetGain); processor=n; break; }
      case "stereo-widener": {
        const split=c.createChannelSplitter(2), merge=c.createChannelMerger(2), mid=c.createGain(), side=c.createGain();
        const width=Number(p.width??1); input.connect(split); split.connect(mid,0); split.connect(mid,1); split.connect(side,0); split.connect(side,1);
        mid.gain.value=1; side.gain.value=width; side.connect(merge,0,0); side.connect(merge,0,1); mid.connect(merge,0,0); mid.connect(merge,0,1); merge.connect(wetGain); processor=split; break;
      }
      case "utility": {
        const g=c.createGain(), pan=c.createStereoPanner(); g.gain.value=db(Number(p.gain??0)); pan.pan.value=clamp(Number(p.pan??0)/100,-1,1);
        input.connect(g); g.connect(pan); pan.connect(wetGain); processor=g; break;
      }
    }
    wetGain.connect(output); bypass();
    return {input,output,reduction:reductionNode,dispose:()=>{},setParameter:param};
  }

  getAnalyzer(id:string): AnalyserNode | undefined { return this.chains.get(id)?.at(-1)?.analyzer; }\n\n  getGainReduction(id:string, effectId?: string): number { return this.chains.get(id)?.find(node => node.reduction && (!effectId || node.effectId === effectId))?.reduction?.reduction ?? 0; }\n\n  createChain(id:string,effects:EffectInstance[]): AudioNode {
    const nodes=effects.map(e=>{ const node=this.createEffect(e); node.effectId=e.id; return node; });\n    const analyzer=this.context.createAnalyser(); analyzer.fftSize=2048; analyzer.smoothingTimeConstant=.82;\n    if(nodes.length) nodes.at(-1)!.output.connect(analyzer);\n    if(nodes.length) { const last=nodes.at(-1) as EffectNode; last.analyzer=analyzer; const compressor=last.output; void compressor; }\n    this.chains.set(id,nodes);
    for(let i=0;i<nodes.length-1;i++) nodes[i].output.connect(nodes[i+1].input);
    return nodes.length?nodes[0].input:this.context.createGain();
  }

  attachSource(id:string,source:AudioNode,effects:EffectInstance[],destination:AudioNode=this.context.destination): void {
    const input=this.createChain(id,effects); source.connect(input);
    const nodes=this.chains.get(id)??[]; (nodes.at(-1)?.output??input).connect(destination);
  }

  disconnect(id:string): void { const nodes=this.chains.get(id); nodes?.forEach(n=>n.dispose()); this.chains.delete(id); }
}
