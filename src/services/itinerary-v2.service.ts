import { supabase } from '../lib/supabase';
import { validateItineraryValues } from './itinerary-validation';
import { scheduleEventService, getMonthRange } from './schedule-event.service';
import type { ScheduleEvent, ScheduleEventType, ScheduleEventStatus } from '../types/database';

export const itineraryCategories = ['会议安排','公司活动','工作计划','培训课程','出差安排','客户预约','其他行程'] as const;
export type ItineraryCategory = typeof itineraryCategories[number];
export type Visibility = 'private' | 'company' | 'selected';
export type ItineraryEmployee = { profile_id:string; full_name:string; nickname:string|null; avatar_url:string|null; region:string|null; job_title:string|null };
export type ItineraryEvent = ScheduleEvent & { visibility: Visibility; end_date: string | null; is_all_day: boolean | null; publisher_name?: string; category?: ItineraryCategory | null };
export type ItineraryValues = { title:string; event_date:string; end_date:string; start_time:string; end_time:string; is_all_day:boolean; location:string; note:string; visibility:Visibility; category:ItineraryCategory; event_type:ScheduleEventType; status:ScheduleEventStatus };
export type ItineraryBackend = { userId:string; superAdmin:boolean; canShare:boolean; available:boolean; selectedAvailable:boolean; list(month:string):Promise<ItineraryEvent[]>; employees():Promise<ItineraryEmployee[]>; recipients(eventId:string):Promise<string[]>; save(values:ItineraryValues,event?:ItineraryEvent,recipients?:string[]):Promise<void>; remove(event:ItineraryEvent):Promise<void> };
const db = supabase as any;
const isMissing = (e:any) => e && (e.code==='42703'||e.code==='PGRST204'||e.code==='PGRST202'||e.code==='42883');
export async function createLiveItineraryBackend(userId:string,superAdmin:boolean):Promise<ItineraryBackend> {
  const probe=await db.from('schedule_events').select('visibility,end_date,is_all_day').limit(1);
  if(probe.error&&!isMissing(probe.error)) throw probe.error;
  const available=!probe.error;
  const categoryProbe=await db.from('schedule_events').select('category').limit(1);
  if(categoryProbe.error&&!isMissing(categoryProbe.error)) throw categoryProbe.error;
  const categoryAvailable=!categoryProbe.error;
  const capability=available?await db.rpc('itinerary_v2_capabilities'):null;
  if(capability?.error&&!isMissing(capability.error)) throw capability.error;
  const selectedAvailable=capability?.data===true;
  const permission=available?await db.rpc('itinerary_can_share'):await db.rpc('current_user_has_explicit_permission',{p_permission_key:'itinerary-share',p_action:'use'});
  if(permission.error&&available) throw permission.error;
  const canShare=!permission.error&&permission.data===true;
  return {userId,superAdmin,canShare,available,selectedAvailable,
    async list(month) {
      if(!available) return (await scheduleEventService.getMyScheduleEvents(month)).map(event=>({...event,visibility:'private',end_date:null,is_all_day:null}));
      const {startDate,endDate}=getMonthRange(month);
      const result=await db.from('schedule_events').select('*').lte('event_date',endDate).or(`end_date.gte.${startDate},and(end_date.is.null,event_date.gte.${startDate})`).order('event_date');
      if(result.error) throw result.error;
      const rows=(result.data??[]) as ItineraryEvent[];
      const shared=rows.filter(row=>row.visibility!=='private').map(row=>row.id);
      if(shared.length){const names=await db.rpc('schedule_event_publishers',{p_ids:shared});if(names.error)throw names.error;const map=new Map<string,string>((names.data??[]).map((row:{event_id:string;publisher_name:string})=>[row.event_id,row.publisher_name]));rows.forEach(row=>{row.publisher_name=map.get(row.id);});}
      return rows;
    },
    async employees(){if(!selectedAvailable)throw new Error('数据库尚未启用指定员工共享。');const r=await db.rpc('itinerary_employee_choices');if(r.error)throw r.error;return r.data??[];},
    async recipients(eventId){if(!selectedAvailable)throw new Error('数据库尚未启用指定员工共享。');const r=await db.rpc('itinerary_event_recipients',{p_event_id:eventId});if(r.error)throw r.error;return (r.data??[]).map((row:{profile_id:string})=>row.profile_id);},
    async save(values,event,recipients=[]){
      validateItineraryValues(values);
      if(values.visibility==='selected'&&(!selectedAvailable||!recipients.length))throw new Error(selectedAvailable?'请选择至少一名其他有效员工。':'数据库尚未启用指定员工共享。');
      if(!available){if(values.visibility!=='private'||values.end_date!==values.event_date)throw new Error('数据库尚未启用共享或跨日行程。');const {category,...legacy}=values;if(category!=='其他行程')throw new Error('数据库尚未启用行程分类。');const v={...legacy,start_time:values.is_all_day?'':values.start_time,end_time:values.is_all_day?'':values.end_time};if(event)await scheduleEventService.updateScheduleEvent(event.id,v);else await scheduleEventService.createScheduleEvent(v);return;}
      const {category,...base}=values;if(!categoryAvailable&&category!=='其他行程')throw new Error('数据库尚未启用行程分类。');
      const payload={...base,...(categoryAvailable?{category}:{}),title:values.title.trim(),start_time:values.is_all_day?null:values.start_time||null,end_time:values.is_all_day?null:values.end_time||null,location:values.location.trim()||null,note:values.note.trim()||null};
      if(selectedAvailable){const result=await db.rpc('itinerary_save_event',{p_event_id:event?.id??null,p_values:payload,p_recipients:values.visibility==='selected'?recipients:[]});if(result.error)throw result.error;return;}
      const result=event?await db.from('schedule_events').update(payload).eq('id',event.id).select('id'):await db.from('schedule_events').insert({...payload,profile_id:userId}).select('id');if(result.error)throw result.error;if(!result.data?.length)throw new Error('保存失败：无权修改此行程。');
    },
    async remove(event){const r=await db.from('schedule_events').delete().eq('id',event.id).select('id');if(r.error)throw r.error;if(!r.data?.length)throw new Error('删除失败：无权修改此行程。');},
  };
}
