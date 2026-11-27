import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { loadWorkList, saveWorkListChanges, type WorkData as Data, type WorkTask as Task, type WorkCategory as Category } from '../services/work-list-v2.service';
import { Check, ClipboardList, ChevronDown, ChevronRight, Folder, FolderPlus, GripVertical, MessageSquare, MoreHorizontal, Plus, RefreshCw, X } from 'lucide-react';

type Drag = { type: 'outer' | 'task' | 'sub'; id: string; taskId?: string };
const uid = () => crypto.randomUUID();
const todayMalaysia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyData: Data = { categories: [], tasks: [], outer: [] };
function reorder<T>(arr:T[], from:number, to:number) { const copy = [...arr]; if (from < 0 || to < 0 || from === to) return copy; const [item] = copy.splice(from,1); copy.splice(to,0,item); return copy; }

export function WorkListV2() {
  const [data,renderData] = useState<Data>(emptyData);
  const current = useRef<Data>(emptyData);
  const revision = useRef('0');
  const confirmed = useRef<Data>(emptyData);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef(false);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const pendingCount = useRef(0);
  const [error,setError] = useState('');
  async function reload() {
    setLoading(true);
    try { await pending.current; const loaded = await loadWorkList(); current.current=loaded.data; confirmed.current=loaded.data; revision.current=loaded.revision; renderData(loaded.data); failed.current=false; setError(''); }
    catch(e) { setError(e instanceof Error ? e.message : '读取工作清单失败，请稍后重试。'); }
    finally { setLoading(false); }
  }
  function setData(update: Data | ((old:Data)=>Data)) {
    if (failed.current || loading) return;
    const before=current.current;
    const next=typeof update==='function'?update(before):update;
    if(next===before || JSON.stringify(next)===JSON.stringify(before)) return;
    current.current=next; renderData(next); pendingCount.current++; setSaving(true);
    pending.current=pending.current.then(async()=>{
      if(failed.current) return;
      try { revision.current = await saveWorkListChanges(before,next,revision.current); confirmed.current=next; }
      catch(e) { failed.current=true; current.current=confirmed.current; renderData(confirmed.current); setError('本次更改未保存，已恢复至上次保存状态：'+(e instanceof Error ? e.message : '保存失败')+'。请刷新并重新操作。'); }
    }).finally(()=>{ pendingCount.current--; if (!pendingCount.current) setSaving(false); });
  }
  const [filter,setFilter] = useState<'open'|'today'|'overdue'|'completed'|'categories'>('open');
  const [closed,setClosed] = useState<string[]>([]);
  const [expanded,setExpanded] = useState<string[]>([]);
  const [menu,setMenu] = useState<string | null>(null);
  const [editor,setEditor] = useState<Task | null>(null);
  const [categoryEditor,setCategoryEditor] = useState<Category | null>(null);
  const [deleteTask,setDeleteTask] = useState<string | null>(null);
  const [newSub,setNewSub] = useState('');
  const [dragging,setDragging] = useState(false);
  const [hover,setHover] = useState('');
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandId = useRef('');
  const startPoint = useRef({x:0,y:0});
  const [ghost,setGhost] = useState<{x:number;y:number;label:string} | null>(null);
  const position = useRef<'before'|'after'>('before');
  const pointer = useRef({x:0,y:0});
  const scrollFrame = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { void reload(); }, []);
  const tasks = data.tasks;
  const counts = { open:tasks.filter(t=>!t.done).length, today:tasks.filter(t=>!t.done && t.date===todayMalaysia()).length, overdue:tasks.filter(t=>!t.done && t.date && t.date<todayMalaysia()).length, completed:tasks.filter(t=>t.done).length, categories:data.categories.length };
  const visible = (t:Task) => filter==='completed' ? t.done : !t.done && ((filter==='open' || filter==='categories') || filter==='today' && t.date===todayMalaysia() || filter==='overdue' && !!t.date && t.date<todayMalaysia());
  const updateTask = (id:string, fn:(t:Task)=>Task) => setData(d=>({...d,tasks:d.tasks.map(t=>t.id===id?fn(t):t)}));
  const moveTask = (id:string, category:string | null, before?:string, outerBefore?:string) => setData(d => { const task=d.tasks.find(t=>t.id===id); if(!task || id===before) return d; const rest=d.tasks.filter(t=>t.id!==id); const target=before ? rest.findIndex(t=>t.id===before) : -1; rest.splice(target<0?rest.length:target,0,{...task,category}); let outer=d.outer.filter(x=>x!==id); if(category===null) { const index=outerBefore ? outer.indexOf(outerBefore) : before ? outer.indexOf(before) : -1; outer.splice(index<0?outer.length:index,0,id); } if(task.category===category && JSON.stringify(d.outer)===JSON.stringify(outer) && JSON.stringify(d.tasks.filter(t=>t.category===category).map(t=>t.id))===JSON.stringify(rest.filter(t=>t.category===category).map(t=>t.id))) return d; return {...d,tasks:rest,outer}; });
  const shift = (type:'outer'|'task'|'sub', id:string, direction:number, taskId?:string) => setData(d=> { if(type==='outer') { const i=d.outer.indexOf(id); const j=i+direction; return j<0||j>=d.outer.length?d:{...d,outer:reorder(d.outer,i,j)}; } if(type==='sub') return {...d,tasks:d.tasks.map(t=> { if(t.id!==taskId)return t; const i=t.subs.findIndex(s=>s.id===id), j=i+direction; return j<0||j>=t.subs.length?t:{...t,subs:reorder(t.subs,i,j)}; })}; const task=d.tasks.find(t=>t.id===id); if(!task)return d; const siblings=d.tasks.filter(t=>t.category===task.category); const i=siblings.findIndex(t=>t.id===id), target=siblings[i+direction]; if(!target)return d; const a=d.tasks.findIndex(t=>t.id===id), b=d.tasks.findIndex(t=>t.id===target.id); return {...d,tasks:reorder(d.tasks,a,b)}; });
  function drop(target:HTMLElement | null) {
    const source=drag.current; if(!source || !target)return;
    let kind=target.dataset.drop, id=target.dataset.id || '';
    if(target.classList.contains('wv-category-body')) { kind='category'; id=target.parentElement?.dataset.id || ''; }
    const after=position.current==='after';
    if(source.type==='sub' && kind==='sub' && target.dataset.task===source.taskId && id!==source.id) {
      setData(d=>({...d,tasks:d.tasks.map(t=>{ if(t.id!==source.taskId)return t; const item=t.subs.find(s=>s.id===source.id), list=t.subs.filter(s=>s.id!==source.id), i=list.findIndex(s=>s.id===id); if(!item||i<0)return t; list.splice(i+(after?1:0),0,item); return {...t,subs:list}; })}));
    } else if(source.type==='outer' && kind==='outer' && id!==source.id) {
      setData(d=>{const list=d.outer.filter(x=>x!==source.id), i=list.indexOf(id); if(i<0)return d; list.splice(i+(after?1:0),0,source.id); return {...d,outer:list};});
    } else if(source.type==='task') {
      if(kind==='category') moveTask(source.id,id);
      else if(kind==='task' && id!==source.id) { const dest=current.current.tasks.find(t=>t.id===id); if(dest) { const siblings=current.current.tasks.filter(t=>t.category===dest.category && t.id!==source.id); const i=siblings.findIndex(t=>t.id===id); const before=after?siblings[i+1]?.id:id; const outer=current.current.outer.filter(x=>x!==source.id); const oi=outer.indexOf(id); moveTask(source.id,dest.category,before,dest.category===null?(after?outer[oi+1]:id):undefined); } }
      else if(kind==='unassigned') moveTask(source.id,null);
    }
  }
  function targetAt(x:number,y:number) {
    const hit=document.elementFromPoint(x,y), source=drag.current; if(!source)return null;
    const selector=source.type==='outer'?'.wv-category[data-drop="outer"],.wv-independent[data-drop="outer"]':source.type==='task'?'[data-drop="task"],[data-drop="category"],[data-drop="unassigned"],.wv-category-body':'[data-drop="sub"]';
    const direct=hit?.closest<HTMLElement>(selector); if(direct && !direct.classList.contains('wv-category-body'))return direct;
    // The animated insertion gap has no element of its own. Resolve it to its closest edge.
    const list=listRef.current; if(!list || !hit || !list.contains(hit))return null;
    const candidates=Array.from(list.querySelectorAll<HTMLElement>(source.type==='outer'?'.wv-category[data-drop="outer"],.wv-independent[data-drop="outer"]':source.type==='task'?'[data-drop="task"]':'[data-drop="sub"]'));
    let nearest:HTMLElement | null=null, distance=32;
    for(const item of candidates) { const r=item.getBoundingClientRect(); if(x<r.left-10 || x>r.right+10)continue; const d=Math.min(Math.abs(y-r.top),Math.abs(y-r.bottom)); if(d<distance){distance=d;nearest=item;} }
    return nearest || direct || null;
  }
  function updateDragTarget(x:number,y:number) {
    const el=targetAt(x,y); const after=!!el && y>el.getBoundingClientRect().top+el.getBoundingClientRect().height/2;
    position.current=after?'after':'before';
    const kind=el?.classList.contains('wv-category-body')?'category':el?.dataset.drop, id=el?.classList.contains('wv-category-body')?el.parentElement?.dataset.id:el?.dataset.id;
    setHover(el && !(id===drag.current?.id && (kind==='task' || kind==='outer' || kind==='sub'))?`${kind}:${id || ''}:${position.current}`:'');
    const category=drag.current?.type==='task'?document.elementFromPoint(x,y)?.closest<HTMLElement>('.wv-category')?.dataset.id:undefined;
    if(category!==expandId.current){if(expandTimer.current)clearTimeout(expandTimer.current);expandId.current=category || '';if(category)expandTimer.current=setTimeout(()=>setClosed(a=>a.filter(item=>item!==category)),650);}
  }
  function autoScroll() {
    if(!drag.current){scrollFrame.current=null;return;}
    const {x,y}=pointer.current; const edge=80;
    let moved=false;
    for(const el of document.elementsFromPoint(x,Math.max(0,Math.min(window.innerHeight-1,y)))) {
      if(!(el instanceof HTMLElement) || el===document.body || el===document.documentElement)continue;
      const style=getComputedStyle(el), rect=el.getBoundingClientRect();
      if(!/(auto|scroll)/.test(style.overflowY) || el.scrollHeight<=el.clientHeight)continue;
      const velocity=y<rect.top+edge?-Math.ceil((rect.top+edge-y)/5):y>rect.bottom-edge?Math.ceil((y-(rect.bottom-edge))/5):0;
      if(velocity){const before=el.scrollTop;el.scrollTop+=Math.max(-22,Math.min(22,velocity));if(el.scrollTop!==before){moved=true;break;}}
    }
    if(!moved) {const velocity=y<edge?-Math.ceil((edge-y)/5):y>window.innerHeight-edge?Math.ceil((y-(window.innerHeight-edge))/5):0; if(velocity){const before=window.scrollY;window.scrollBy(0,Math.max(-22,Math.min(22,velocity)));moved=window.scrollY!==before;}}
    if(moved)updateDragTarget(x,y);
    scrollFrame.current=requestAnimationFrame(autoScroll);
  }
  function cleanup() { if(timer.current)clearTimeout(timer.current); if(expandTimer.current)clearTimeout(expandTimer.current); if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current); scrollFrame.current=null; expandId.current=''; drag.current=null; setDragging(false); setHover(''); setGhost(null); }
  useEffect(()=>{ const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cleanup();}; window.addEventListener('keydown',key); return ()=>{window.removeEventListener('keydown',key); if(timer.current)clearTimeout(timer.current); if(expandTimer.current)clearTimeout(expandTimer.current); if(scrollFrame.current!==null)cancelAnimationFrame(scrollFrame.current);}; },[]);
  function handlePointer(e:PointerEvent<HTMLButtonElement>, source:Drag) { if(e.button!==0 || loading || failed.current)return; const handle=e.currentTarget, x=e.clientX, y=e.clientY; startPoint.current={x,y}; pointer.current={x,y}; const label=source.type==='outer'?current.current.categories.find(c=>c.id===source.id)?.name:source.type==='task'?current.current.tasks.find(t=>t.id===source.id)?.title:current.current.tasks.find(t=>t.id===source.taskId)?.subs.find(s=>s.id===source.id)?.title; const start=()=>{drag.current=source;setDragging(true);setGhost({x:pointer.current.x,y:pointer.current.y,label:label || '移动'});scrollFrame.current=requestAnimationFrame(autoScroll);}; if(e.pointerType==='touch') timer.current=setTimeout(start,350); else start(); handle.setPointerCapture(e.pointerId); }
  function pointerMove(e:PointerEvent<HTMLButtonElement>) { pointer.current={x:e.clientX,y:e.clientY}; if(!drag.current){if(Math.hypot(e.clientX-startPoint.current.x,e.clientY-startPoint.current.y)>8 && timer.current)clearTimeout(timer.current);return;} e.preventDefault(); setGhost(g=>g?{...g,x:e.clientX,y:e.clientY}:g); updateDragTarget(e.clientX,e.clientY); }
  function pointerUp(e:PointerEvent<HTMLButtonElement>) { if(drag.current){updateDragTarget(e.clientX,e.clientY);drop(targetAt(e.clientX,e.clientY));} cleanup(); }
  const grip = (source:Drag) => <button type="button" className="wv-grip" aria-label="按住拖动排序" title="按住拖动排序" onPointerDown={e=>handlePointer(e,source)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cleanup}><GripVertical size={16}/></button>;
  const dropClass = (type:string,id:string) => hover===`${type}:${id}:before`?' wv-drop-before':hover===`${type}:${id}:after`?' wv-drop-after':'';
  function saveTask() { if(!editor?.title.trim())return; setData(d=> { const exists=d.tasks.some(t=>t.id===editor.id); const outer=d.outer.filter(x=>x!==editor.id); if(!editor.category) { const old=d.outer.indexOf(editor.id); outer.splice(old<0?outer.length:Math.min(old,outer.length),0,editor.id); } return {...d,tasks:exists?d.tasks.map(t=>t.id===editor.id?editor:t):[...d.tasks,editor],outer}; }); setEditor(null); setNewSub(''); }
  const newTask = () => setEditor({id:uid(),title:'',category:null,date:'',priority:'普通',note:'',done:false,subs:[]});
  function taskRow(t:Task) { const isExpanded=expanded.includes(t.id); return <div className={'wv-task-wrap'+dropClass('task',t.id)} key={t.id} data-drop="task" data-id={t.id}><div className="wv-task">
    {grip({type:'task',id:t.id})}<input type="checkbox" aria-label={`完成 ${t.title}`} checked={t.done} onChange={()=>updateTask(t.id,x=>({...x,done:!x.done}))}/><button className={'wv-task-name'+(t.done?' done':'')} onClick={()=>{setEditor({...t,subs:t.subs.map(s=>({...s}))});setMenu(null);}}>{t.title}</button>
    {t.note && <button className="wv-small-icon" aria-label="查看备注" onClick={()=>setEditor({...t,subs:t.subs.map(s=>({...s}))})}><MessageSquare size={15}/></button>}{t.date && <span className="wv-date">{t.date.slice(5)}</span>}{t.subs.length>0 && <button className="wv-sub-toggle" onClick={()=>setExpanded(a=>isExpanded?a.filter(x=>x!==t.id):[...a,t.id])}>{t.subs.filter(s=>s.done).length}/{t.subs.length} {isExpanded?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>}
    <div className="wv-menu-wrap"><button className="wv-small-icon" aria-label={`${t.title} 更多操作`} onClick={()=>setMenu(menu===t.id?null:t.id)}><MoreHorizontal size={18}/></button>{menu===t.id && <div className="wv-menu"><button onClick={()=>{shift(t.category?'task':'outer',t.id,-1);setMenu(null);}}>上移</button><button onClick={()=>{shift(t.category?'task':'outer',t.id,1);setMenu(null);}}>下移</button><button onClick={()=>{moveTask(t.id,null);setMenu(null);}}>移为独立工作</button>{data.categories.filter(c=>c.id!==t.category).map(c=><button key={c.id} onClick={()=>{moveTask(t.id,c.id);setMenu(null);}}>移动至 {c.name}</button>)}<button onClick={()=>{setEditor({...t,subs:t.subs.map(s=>({...s}))});setMenu(null);}}>编辑</button><button className="wv-danger" onClick={()=>{setDeleteTask(t.id);setMenu(null);}}>删除</button></div>}</div></div>
    {isExpanded && <div className="wv-subs"><div className="wv-sub-heading">子任务 <span>{t.subs.filter(s=>s.done).length}/{t.subs.length} · {Math.round(t.subs.filter(s=>s.done).length/t.subs.length*100)}%</span></div><div className="wv-progress"><i style={{width:`${t.subs.filter(s=>s.done).length/t.subs.length*100}%`}}/></div>{t.subs.map(s=><div className={'wv-sub'+dropClass('sub',s.id)} key={s.id} data-drop="sub" data-id={s.id} data-task={t.id}>{grip({type:'sub',id:s.id,taskId:t.id})}<input type="checkbox" aria-label={`完成 ${s.title}`} checked={s.done} onChange={()=>updateTask(t.id,x=>({...x,subs:x.subs.map(a=>a.id===s.id?{...a,done:!a.done}:a)}))}/><span>{s.title}</span><button onClick={()=>shift('sub',s.id,-1,t.id)} aria-label="子任务上移">↑</button><button onClick={()=>shift('sub',s.id,1,t.id)} aria-label="子任务下移">↓</button><button onClick={()=>setEditor({...t,subs:t.subs.map(a=>({...a}))})}>编辑</button></div>)}</div>}</div>; }
  return <div className="dashboard-panel todo-panel wv-panel"><div className="wv-header"><div><h3>我的工作清单</h3><p>安排工作，掌握每一天的进度 </p></div><div className="wv-actions"><button title="刷新" aria-label="刷新工作清单" disabled={loading || saving} onClick={()=>void reload()}><RefreshCw size={17}/></button><button disabled={loading || !!error} onClick={()=>setCategoryEditor({id:uid(),name:'',color:'#8b6bdc'})}><FolderPlus size={16}/> 新增分类</button><button className="wv-primary" disabled={loading || !!error} onClick={newTask}><Plus size={16}/> 新增工作</button></div></div>
  {error && <p className="form-alert" role="alert">{error}</p>}
  {loading && <p className="wv-empty">正在读取工作清单...</p>}
  {saving && <p className="wv-empty" role="status">正在保存...</p>}
  <div className="wv-stats">
    <button type="button" className="wv-stat wv-stat-open" aria-pressed={filter==='open'} onClick={()=>setFilter('open')}><span className="wv-stat-icon" aria-hidden="true"><ClipboardList size={21}/></span><div className="wv-stat-content"><span className="wv-stat-label">待完成工作</span><div className="wv-stat-value"><strong>{counts.open}</strong><span>项</span></div></div></button>
    <button type="button" className="wv-stat wv-stat-category" aria-pressed={filter==='categories'} onClick={()=>setFilter('categories')}><span className="wv-stat-icon" aria-hidden="true"><Folder size={21}/></span><div className="wv-stat-content"><span className="wv-stat-label">工作分类</span><div className="wv-stat-value"><strong>{data.categories.length}</strong><span>个</span></div></div></button>
    <button type="button" className="wv-stat wv-stat-completed" aria-pressed={filter==='completed'} onClick={()=>setFilter('completed')}><span className="wv-stat-icon" aria-hidden="true"><Check size={22}/></span><div className="wv-stat-content"><span className="wv-stat-label">已完成</span><div className="wv-stat-value"><strong>{counts.completed}</strong><span>项</span></div></div></button>
  </div>
  <div className="wv-filters">{([['open','待办'],['today','今天'],['overdue','逾期'],['categories','分类'],['completed','已完成']] as const).map(([id,label])=><button key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label} <span>{counts[id]}</span></button>)}</div>
  <div ref={listRef} className={'wv-list'+(dragging?' wv-is-dragging':'')} aria-busy={loading || saving} style={{pointerEvents:loading || !!error ? 'none' : undefined}}>{data.outer.map(id=> { const c=data.categories.find(x=>x.id===id); if(!c) { const t=tasks.find(x=>x.id===id); return filter!=='categories' && t && visible(t) ? <div key={id} className={'wv-independent'+dropClass('outer',id)} data-drop="outer" data-id={id}>{taskRow(t)}</div> : null; } const all=tasks.filter(t=>t.category===c.id), shown=all.filter(visible), done=all.filter(t=>t.done).length, percent=all.length?Math.round(done/all.length*100):0, isClosed=closed.includes(c.id); return <div className={'wv-category'+dropClass('outer',id)+dropClass('category',id)} key={id} data-drop="outer" data-id={id}><div className="wv-category-head" data-drop="category" data-id={id}>{grip({type:'outer',id})}<button className="wv-fold" aria-label={`${isClosed?'展开':'收起'} ${c.name}`} onClick={()=>setClosed(a=>isClosed?a.filter(x=>x!==id):[...a,id])}>{isClosed?<ChevronRight size={17}/>:<ChevronDown size={17}/>}</button><Folder size={21} fill={c.color} color={c.color}/><button className="wv-category-name" onClick={()=>setClosed(a=>isClosed?a.filter(x=>x!==id):[...a,id])}>{c.name}</button><span className="wv-count">{done}/{all.length}</span><div className="wv-progress"><i style={{width:`${percent}%`,background:c.color}}/></div><span className="wv-percent">{percent}%</span><div className="wv-menu-wrap"><button className="wv-small-icon" aria-label={`${c.name} 更多操作`} onClick={()=>setMenu(menu===id?null:id)}><MoreHorizontal size={18}/></button>{menu===id && <div className="wv-menu"><button onClick={()=>{shift('outer',id,-1);setMenu(null);}}>上移</button><button onClick={()=>{shift('outer',id,1);setMenu(null);}}>下移</button><button onClick={()=>{setCategoryEditor({...c});setMenu(null);}}>编辑分类</button><button className="wv-danger" onClick={()=>{if(window.confirm(`删除「${c.name}」？内部工作会保留为独立工作。`)) setData(d=>({...d,categories:d.categories.filter(x=>x.id!==id),tasks:d.tasks.map(t=>t.category===id?{...t,category:null}:t),outer:d.outer.flatMap(x=>x===id?d.tasks.filter(t=>t.category===id).map(t=>t.id):[x])}));setMenu(null);}}>删除分类</button></div>}</div></div>{!isClosed && <div className={'wv-category-body'+dropClass('category',id)}>{shown.length?shown.map(taskRow):<div className="wv-empty">{all.length?'此筛选下暂无工作':'暂无工作，可拖动工作到此分类'}</div>}</div>}</div>; })}<div className={'wv-unassigned'+(dragging?' visible':'')+dropClass('unassigned','')} data-drop="unassigned">拖放到这里，移为独立工作</div></div>
  {ghost && <div className="wv-drag-ghost" style={{left:ghost.x+12,top:ghost.y+12}}>{ghost.label}</div>}
  {editor && <div className="wv-overlay" onClick={()=>setEditor(null)}><section className="wv-dialog" onClick={e=>e.stopPropagation()}><header><h3>{tasks.some(t=>t.id===editor.id)?'工作详情':'新增工作'}</h3><button onClick={()=>setEditor(null)} aria-label="关闭"><X/></button></header><div className="wv-dialog-body"><label>工作名称 <b>*</b><input autoFocus value={editor.title} onChange={e=>setEditor({...editor,title:e.target.value})} placeholder="输入工作名称"/></label><label>所属分类<select value={editor.category||''} onChange={e=>setEditor({...editor,category:e.target.value||null})}><option value="">独立工作</option>{data.categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><div className="wv-form-row"><label>截止日期<input type="date" value={editor.date} onChange={e=>setEditor({...editor,date:e.target.value})}/></label><label>优先级<select value={editor.priority} onChange={e=>setEditor({...editor,priority:e.target.value})}><option>普通</option><option>高</option><option>低</option></select></label></div><label>备注<textarea rows={3} value={editor.note} onChange={e=>setEditor({...editor,note:e.target.value})} placeholder="添加备注（选填）"/></label><div className="wv-edit-subs"><strong>子任务</strong>{editor.subs.map((s,i)=><div key={s.id}><input type="checkbox" checked={s.done} onChange={()=>setEditor({...editor,subs:editor.subs.map(x=>x.id===s.id?{...x,done:!x.done}:x)})}/><input value={s.title} aria-label="子任务名称" onChange={e=>setEditor({...editor,subs:editor.subs.map(x=>x.id===s.id?{...x,title:e.target.value}:x)})}/><button onClick={()=>setEditor({...editor,subs:reorder(editor.subs,i,Math.max(0,i-1))})}>↑</button><button onClick={()=>setEditor({...editor,subs:reorder(editor.subs,i,Math.min(editor.subs.length-1,i+1))})}>↓</button><button onClick={()=>setEditor({...editor,subs:editor.subs.filter(x=>x.id!==s.id)})}>×</button></div>)}<div><input placeholder="添加子任务" value={newSub} onChange={e=>setNewSub(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault(); if(newSub.trim()){setEditor({...editor,subs:[...editor.subs,{id:uid(),title:newSub.trim(),done:false}]});setNewSub('');}}}}/><button onClick={()=>{if(newSub.trim()){setEditor({...editor,subs:[...editor.subs,{id:uid(),title:newSub.trim(),done:false}]});setNewSub('');}}}>添加</button></div></div></div><footer><button onClick={()=>setEditor(null)}>取消</button><button className="wv-primary" disabled={!editor.title.trim()} onClick={saveTask}>保存</button></footer></section></div>}
  {categoryEditor && <div className="wv-overlay" onClick={()=>setCategoryEditor(null)}><section className="wv-dialog wv-dialog-small" onClick={e=>e.stopPropagation()}><header><h3>编辑分类</h3><button onClick={()=>setCategoryEditor(null)} aria-label="关闭"><X/></button></header><div className="wv-dialog-body"><label>分类名称<input autoFocus value={categoryEditor.name} onChange={e=>setCategoryEditor({...categoryEditor,name:e.target.value})}/></label><label>分类颜色<input type="color" value={categoryEditor.color} onChange={e=>setCategoryEditor({...categoryEditor,color:e.target.value})}/></label></div><footer><button onClick={()=>setCategoryEditor(null)}>取消</button><button className="wv-primary" disabled={!categoryEditor.name.trim()} onClick={()=>{setData(d=>{const exists=d.categories.some(c=>c.id===categoryEditor.id);return {...d,categories:exists?d.categories.map(c=>c.id===categoryEditor.id?categoryEditor:c):[...d.categories,categoryEditor],outer:exists?d.outer:[...d.outer,categoryEditor.id]};});setCategoryEditor(null);}}>保存</button></footer></section></div>}
  {deleteTask && <div className="wv-overlay"><section className="wv-dialog wv-dialog-small"><header><h3>删除工作</h3></header><div className="wv-dialog-body">确定删除「{tasks.find(t=>t.id===deleteTask)?.title}」及其子任务吗？</div><footer><button onClick={()=>setDeleteTask(null)}>取消</button><button className="wv-primary" onClick={()=>{setData(d=>({...d,tasks:d.tasks.filter(t=>t.id!==deleteTask),outer:d.outer.filter(id=>id!==deleteTask)}));setDeleteTask(null);}}>确定删除</button></footer></section></div>}
  </div>;
}

