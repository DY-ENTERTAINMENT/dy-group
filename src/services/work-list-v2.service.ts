import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { todoService } from './todo.service';

export type WorkSub = { id: string; title: string; done: boolean };
export type WorkTask = { id: string; title: string; category: string | null; date: string; priority: string; note: string; done: boolean; subs: WorkSub[] };
export type WorkCategory = { id: string; name: string; color: string };
type StoredOrder = { categories: Record<string, number | null>; tasks: Record<string, { sort: number | null; outer: number | null }>; subs: Record<string, number | null> };
export type WorkData = { categories: WorkCategory[]; tasks: WorkTask[]; outer: string[]; storedOrder?: StoredOrder };
type RowCategory = { id:string; name:string; color:string; outer_order:number|null; created_at:string };
type RowTask = { id:string; title:string; category_v2_id:string|null; due_date:string|null; priority_v2:string; note_v2:string; is_completed:boolean; sort_v2:number|null; outer_order_v2:number|null; created_at:string };
type RowSub = { id:string; todo_id:string; title:string; is_completed:boolean; sort_order:number; created_at:string };
const client = supabase as unknown as SupabaseClient;
const compare = (a:{order:number|null; created:string; id:string}, b:{order:number|null; created:string; id:string}) => (a.order ?? Number.MAX_SAFE_INTEGER)-(b.order ?? Number.MAX_SAFE_INTEGER) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);

async function getRevision(): Promise<string> {
  const {data, error} = await client.rpc('get_todo_worklist_v2_revision');
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('无法读取工作清单版本。');
  return data;
}
export async function loadWorkList(): Promise<{ data: WorkData; revision: string }> {
  await todoService.syncTodayRecurringTodos();
  const { data:auth, error:authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error('请先登录后再管理工作清单。');
  const revision = await getRevision();
  const [categories,tasks,subs] = await Promise.all([
    client.from('todo_categories_v2').select('id,name,color,outer_order,created_at').eq('profile_id',auth.user.id),
    client.from('todo_items').select('id,title,category_v2_id,due_date,priority_v2,note_v2,is_completed,sort_v2,outer_order_v2,created_at').eq('profile_id',auth.user.id),
    client.from('todo_subtasks_v2').select('id,todo_id,title,is_completed,sort_order,created_at').eq('profile_id',auth.user.id),
  ]);
  if(categories.error) throw categories.error; if(tasks.error) throw tasks.error; if(subs.error) throw subs.error;
  if (revision !== await getRevision()) throw new Error('工作清单在读取时发生变化，请刷新重试。');
  const cs=categories.data as RowCategory[], ts=tasks.data as RowTask[], ss=subs.data as RowSub[];
  const orderedTasks=[...ts].sort((a,b)=>compare({order:a.sort_v2,created:a.created_at,id:a.id},{order:b.sort_v2,created:b.created_at,id:b.id}));
  const outer=[...cs.map(c=>({id:c.id,order:c.outer_order,created:c.created_at})),...ts.filter(t=>!t.category_v2_id).map(t=>({id:t.id,order:t.outer_order_v2,created:t.created_at}))].sort(compare).map(x=>x.id);
  const storedOrder: StoredOrder = { categories:Object.fromEntries(cs.map(c=>[c.id,c.outer_order])), tasks:Object.fromEntries(ts.map(t=>[t.id,{sort:t.sort_v2,outer:t.outer_order_v2}])), subs:Object.fromEntries(ss.map(s=>[s.id,s.sort_order])) };
  return { revision, data: { storedOrder, categories:cs.map(c=>({id:c.id,name:c.name,color:c.color})), tasks:orderedTasks.map(t=>({id:t.id,title:t.title,category:t.category_v2_id,date:t.due_date||'',priority:t.priority_v2,note:t.note_v2,done:t.is_completed,subs:ss.filter(s=>s.todo_id===t.id).sort((a,b)=>compare({order:a.sort_order,created:a.created_at,id:a.id},{order:b.sort_order,created:b.created_at,id:b.id})).map(s=>({id:s.id,title:s.title,done:s.is_completed}))})), outer } };
}

type Patch = Record<string, string | number | boolean | null>;
function changed(id:string, before:Patch | undefined, after:Patch): Patch | null { const patch:Patch={id}; if (!before) patch.new=true; for(const [key,value] of Object.entries(after)) if(!before || before[key]!==value) patch[key]=value; return Object.keys(patch).length>1?patch:null; }
export async function saveWorkListChanges(before:WorkData, after:WorkData, revision:string): Promise<string> {
  const outerChanged=JSON.stringify(before.outer)!==JSON.stringify(after.outer);
  const taskOrderChanged=JSON.stringify(before.tasks.map(t=>[t.id,t.category]))!==JSON.stringify(after.tasks.map(t=>[t.id,t.category]));
  const categories:Patch[]=[], tasks:Patch[]=[], subtasks:Patch[]=[];
  for(const c of after.categories) { const old=before.categories.find(x=>x.id===c.id); const previous=old ? {name:old.name,color:old.color,...(outerChanged && !before.storedOrder?{}:{outer_order:outerChanged?before.storedOrder!.categories[c.id]:before.outer.indexOf(c.id)})} : undefined; const next={name:c.name,color:c.color,outer_order:after.outer.indexOf(c.id)}; const p=changed(c.id,previous,next); if(p) categories.push(p); }
  for(const [i,t] of after.tasks.entries()) {
    const old=before.tasks.find(x=>x.id===t.id);
    const fields=(x:WorkTask) => ({title:x.title,category:x.category,date:x.date||null,priority:x.priority,note:x.note,done:x.done});
    const previous=old ? {...fields(old),...(taskOrderChanged && !before.storedOrder?{}:{sort:taskOrderChanged?before.storedOrder!.tasks[t.id]?.sort:before.tasks.indexOf(old)}),...(outerChanged && !before.storedOrder?{}:{outer_order:outerChanged?before.storedOrder!.tasks[t.id]?.outer:(before.outer.indexOf(t.id)<0?null:before.outer.indexOf(t.id))})} : undefined;
    const next={...fields(t),sort:i,outer_order:after.outer.indexOf(t.id)<0?null:after.outer.indexOf(t.id)};
    const p=changed(t.id,previous,next); if(p) tasks.push(p);
    const subsChanged=!old || JSON.stringify(old.subs.map(s=>s.id))!==JSON.stringify(t.subs.map(s=>s.id));
    for(const [j,s] of t.subs.entries()) { const prior=old?.subs.find(x=>x.id===s.id); const previousSub=prior?{title:prior.title,done:prior.done,...(subsChanged && !before.storedOrder?{}:{sort:subsChanged?before.storedOrder!.subs[s.id]:old!.subs.indexOf(prior)})}:undefined; const nextSub={title:s.title,done:s.done,sort:j,...(!prior?{task_id:t.id}:{})}; const sp=changed(s.id,previousSub,nextSub); if(sp) subtasks.push(sp); }
  }
  const deletedTasks=before.tasks.filter(t=>!after.tasks.some(x=>x.id===t.id));
  const delete_subtasks=before.tasks.filter(t=>!deletedTasks.some(x=>x.id===t.id)).flatMap(t=>t.subs.filter(s=>!after.tasks.find(x=>x.id===t.id)?.subs.some(x=>x.id===s.id)).map(s=>s.id));
  const changes={categories,tasks,subtasks,delete_subtasks,delete_tasks:deletedTasks.map(t=>t.id),delete_categories:before.categories.filter(c=>!after.categories.some(x=>x.id===c.id)).map(c=>c.id)};
  if(Object.values(changes).every(x=>x.length===0)) return revision;
  const {data,error}=await client.rpc('apply_todo_v2_changes',{p_changes:changes,p_revision:revision});
  if(error) throw new Error(error.message.includes('WORKLIST_V2_CONFLICT') ? '工作清单已在其他窗口更新，未保存本次更改' : error.message);
  if(typeof data !== 'string') throw new Error('未能确认保存版本，请刷新。');
  // Snapshots in the serial save queue share this baseline; update it only after a confirmed commit.
  const stored=before.storedOrder;
  if(stored) {
    for(const p of categories) { if ('outer_order' in p) stored.categories[String(p.id)]=p.outer_order as number | null; }
    for(const p of tasks) { const id=String(p.id); const previous=stored.tasks[id] || {sort:null,outer:null}; stored.tasks[id]={sort:'sort' in p?p.sort as number | null:previous.sort,outer:'outer_order' in p?p.outer_order as number | null:previous.outer}; }
    for(const p of subtasks) { if ('sort' in p) stored.subs[String(p.id)]=p.sort as number | null; }
    for(const id of changes.delete_categories) delete stored.categories[id];
    for(const id of changes.delete_tasks) delete stored.tasks[id];
    for(const id of changes.delete_subtasks) delete stored.subs[id];
  }
  return data;
}
