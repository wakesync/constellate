// Private cooperation panel (tracks 2.4 + 2.5): grant one exact summary to one member's agent,
// ask for a circle reading built only from what members approved for you, and see the circle
// board (whose context moved readings, counts only). Talks to /api/circles/:id/{grants,circle-reading,board}.
import {useEffect,useState,type FormEvent} from 'react';
import {Card,CardHeading,ButtonInk,ButtonGhost} from './ui';

type Api=(path:string,body?:unknown,method?:string)=>Promise<any>;
type Member={id:string;display_name:string|null};
type Grant={id:string;ownerId:string;granteeId:string;status:string;summary?:string};
type Attribution={memberId:string;name:string;label:string;citations:number};
type CircleReading={id:string;question:string;text:string;model:string;verification:string;attribution:Attribution[]};
type BoardRow={memberId:string;name:string;activeGrants:number;readingsContributed:number;readingsMoved:number;citations:number};

export function CircleBoard({circleId,selfId,members,api}:{circleId:string;selfId:string;members:Member[];api:Api}){
 const [grants,setGrants]=useState<Grant[]>([]),[configured,setConfigured]=useState(false),[board,setBoard]=useState<{readings:number;board:BoardRow[]}|null>(null);
 const [reading,setReading]=useState<CircleReading|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const base=`/circles/${circleId}`;const name=(id:string)=>members.find(m=>m.id===id)?.display_name||'member';
 async function load(){const [g,b]=await Promise.all([api(base+'/grants'),api(base+'/board')]);setGrants(g.grants);setConfigured(g.membraneConfigured);setBoard(b);
  const r=await api(base+'/circle-readings');setReading(r.readings[0]??null);}
 useEffect(()=>{load().catch(e=>setError((e as Error).message));},[circleId]);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const form=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const el=e.currentTarget;return {el,f:Object.fromEntries(new FormData(el)) as Record<string,string>};};
 const mine=grants.filter(g=>g.ownerId===selfId),toMe=grants.filter(g=>g.granteeId===selfId);
 const others=members.filter(m=>m.id!==selfId);const max=Math.max(1,...(board?.board??[]).map(b=>b.citations));
 return <Card className="mt-5"><CardHeading eyebrow="private cooperation · membrane" title="circle reading & board"/>
  {error&&<p role="alert" className="preview-error">{error}</p>}
  <p className="fine">{configured?'Each grant is one exact summary for one member\'s agent, held in Membrane. Revoke it and future reads stop.':'Membrane is not configured. Grants and circle readings are unavailable, not simulated.'}</p>
  <h3 className="font-serif text-xl mt-5">grant a summary to one member</h3>
  <form onSubmit={e=>{const {el,f}=form(e);run(async()=>{await api(base+'/grants',{summary:f.summary,to:f.to,consent:true});el.reset();});}}>
   <label>For<select name="to" required className="block mt-2">{others.map(m=><option key={m.id} value={m.id}>{m.display_name||'member'}'s agent</option>)}</select></label>
   <label>Exact text they may use<textarea name="summary" required maxLength={1500} placeholder="I need a beat before hard conversations."/></label>
   <label className="check"><input type="checkbox" required/>Only this text, only this member's agent. No chart, reading or chat.</label>
   <ButtonInk disabled={busy||!configured||!others.length}>grant</ButtonInk>
  </form>
  {mine.map(g=><p className="fine" key={g.id}>to {name(g.granteeId)}: {g.status} · {g.summary} <ButtonGhost disabled={busy} onClick={()=>run(async()=>{await api(`${base}/grants/${g.id}`,undefined,'DELETE');})}>revoke</ButtonGhost></p>)}
  {toMe.length>0&&<p className="fine">Approved for your agent: {toMe.map(g=>name(g.ownerId)).join(', ')}.</p>}
  <hr/>
  <h3 className="font-serif text-xl">ask for a circle reading</h3>
  <p className="fine">Your agent reads, through Membrane, only what each member approved for you. Every contribution is attributed.</p>
  <form onSubmit={e=>{const {el,f}=form(e);run(async()=>{const r=await api(base+'/circle-reading',{question:f.question});setReading(r.reading);el.reset();});}}>
   <label>Question<textarea name="question" required maxLength={500} placeholder="What is our circle like this week?"/></label>
   <ButtonInk disabled={busy||!configured}>{busy?'agents are reading…':'make circle reading'}</ButtonInk>
  </form>
  {reading&&<div className="chat-message"><span className="eyebrow">{reading.question}</span><p>{reading.text}</p>
   <p className="fine">{reading.attribution.map(a=>`[${a.label}] ${a.name}${a.memberId===selfId?' (you)':''}: cited ${a.citations}×`).join(' · ')} · Tinfoil · {reading.verification}</p></div>}
  <hr/>
  <h3 className="font-serif text-xl">circle board</h3>
  <p className="fine">Whose context moved the circle's readings. Counts only: no one's summaries, chart or chats appear here. {board?.readings??0} readings so far.</p>
  <ul className="member-list">{(board?.board??[]).map(b=><li key={b.memberId} style={{padding:'10px 0'}}>
   <div style={{display:'flex',justifyContent:'space-between',font:'16px Fraunces,serif'}}><span>{b.name}{b.memberId===selfId?' (you)':''}</span><span>{b.citations} cites</span></div>
   <div aria-hidden style={{height:4,background:'#a98a3d22',marginTop:6}}><div style={{height:4,width:`${(b.citations/max)*100}%`,background:'#a98a3d'}}/></div>
   <small className="fine">{b.activeGrants} active grants · moved {b.readingsMoved} of {b.readingsContributed} readings it fed</small></li>)}</ul>
 </Card>;
}
