
import { useEffect, useState } from "react";
import { useBeatRoom } from "./collaboration";
import "./styles.css";

const tools = ["Playlist","Step Sequencer","Piano Roll","Mixer","Browser","Synthesizer","Effects"] as const;
const people = [
  ["You","Drums","YO"],["Alex","Bass","AL"],["Mia","Piano","MI"],["Noah","Synth","NO"],["Lena","Mixer","LE"]
];

export default function App() {
  const [active, setActive] = useState<(typeof tools)[number]>("Step Sequencer");
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(128);
  const [steps, setSteps] = useState([0,3,4,7,8,10,12,15]);
  const { state: roomState, presence, updatePresence, publishCursor } = useBeatRoom();
  const currentArea = active;
  useEffect(() => { updatePresence(currentArea); }, [currentArea]);

  const toggle = (n:number) => setSteps(s => s.includes(n) ? s.filter(x => x !== n) : [...s,n]);

  return <main className="studio">
    <header className="topbar">
      <div className="brand"><b>S</b><div><strong>Sorashi Beat Studio</strong><small>Telegram shared room</small></div></div>
      <div className="presence"><i className={roomState === "live" ? "live" : ""}/>{presence.filter(p => p.status === "online").length || 0} online · Beat Room</div>
      <div className="transport">
        <button onClick={() => setPlaying(!playing)} className="play">{playing ? "❚❚" : "▶"}</button>
        <label>BPM <input type="number" min="40" max="240" value={bpm} onChange={e=>setBpm(Number(e.target.value))}/></label>
      </div>
    </header>

    <div className="workspace">
      <nav className="rail">
        <span className="rail-title">CREATE</span>
        {tools.map(t=><button className={active===t ? "nav active" : "nav"} onClick={()=>setActive(t)} key={t}><span>{icon(t)}</span>{t}</button>)}
      </nav>

      <section className="content" onPointerMove={e => publishCursor(e.clientX, e.clientY, currentArea)}>
        <div className="hero">
          <div><small>SHARED BEAT ROOM</small><h1>Make a beat together.</h1><p>Everyone here can edit every part of the project. No roles or per-track permissions.</p></div>
          <div className="avatars">{presence.map(p=><span key={p.actorId} className={p.status === "online" ? "presence-avatar online" : "presence-avatar"} title={p.username ? "@" + p.username : p.firstName}>{p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : initials(p.firstName)}</span>)}</div>
        </div>

        <div className="remote-cursors">{presence.filter(p => p.status === "online" && p.cursor).map(p => <span key={p.actorId} className="remote-cursor" style={{ left: p.cursor!.x, top: p.cursor!.y }}><i/>{p.username ? "@" + p.username : p.firstName} · {p.area}</span>)}</div><div className="grid">
          <Panel title="Playlist" sub="Arrangement" cls="wide"><div className="timeline">
            {["Drums","Bass","Piano","Synth"].map((t,i)=><div className="track" key={t}><label>{t}</label><div className="clips">{Array.from({length:8},(_,n)=><span className={"clip c"+i} key={n}>{n===0?"Loop":""}</span>)}</div></div>)}
          </div></Panel>

          <Panel title="Room" sub="Everyone can edit everything"><div className="members">{people.map(p=><div className="member" key={p[0]}><span>{p[2]}</span><div><b>{p[0]}</b><small>{p[1]}</small></div><em>{p[0]==="You"?"You":"Editing"}</em></div>)}</div></Panel>

          <Panel title="Step Sequencer" sub="Kick · 16 steps" cls="large"><div className="seq">{["KICK","SNARE","HAT"].map((r,row)=><div className="seqrow" key={r}><label>{r}</label><div>{Array.from({length:16},(_,n)=>{const on=row===0?steps.includes(n):row===1?[4,12].includes(n):[2,6,10,14].includes(n); return <button key={n} className={on?"step on":"step"} onClick={()=>row===0&&toggle(n)}/>})}</div></div>)}</div><footer>{steps.length} active kick steps <span>● Shared live</span></footer></Panel>

          <Panel title="Piano Roll" sub="Melody · C minor"><div className="piano"><aside>{["C","B","A","G","F","E","D"].map(x=><span key={x}>{x}</span>)}</aside><div className="notes"><i/><i/><i/><i/></div></div></Panel>

          <Panel title="Mixer" sub="Main mix"><div className="mixer">{["Drums","Bass","Piano","Synth","Master"].map((x,i)=><div className="channel" key={x}><div className="meter"><i style={{height:(35+i*11)+"%"}}/></div><div className="fader"><i style={{bottom:(28+i*7)+"%"}}/></div><small>{x}</small></div>)}</div></Panel>
          <Panel title="Browser" sub="Sounds"><div className="browser">{["Deep Kick","Sub Bass 01","Warm Piano","Analog Pad","Crisp Hat"].map(x=><button key={x}>♪ <span>{x}</span><small>SOUND</small></button>)}</div></Panel>
          <Panel title="Synthesizer" sub="Shared instrument"><div className="synth"><div className="scope">∿∿∿∿∿∿</div><div>{["Cutoff","Res","Attack","Release"].map(x=><span key={x}><i/>{x}</span>)}</div></div></Panel>
          <Panel title="Effects" sub="Master chain" cls="full"><div className="effects">{["EQ","Compressor","Reverb","Limiter"].map(x=><button key={x}>● {x}</button>)}</div></Panel>
        </div>
      </section>
    </div>
  </main>;
}

function Panel({title,sub,children,cls=""}:{title:string,sub:string,children:React.ReactNode,cls?:string}) {
  return <section className={"panel "+cls}><header><div><h2>{title}</h2><small>{sub}</small></div><button>•••</button></header>{children}</section>;
}
function initials(name:string){return name.trim().split(/\\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}\nfunction icon(t:string){return ({Playlist:"▤","Step Sequencer":"▦","Piano Roll":"⌁",Mixer:"▥",Browser:"⌕",Synthesizer:"◉",Effects:"✦"} as Record<string,string>)[t]}
