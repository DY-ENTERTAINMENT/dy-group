import { RevenueBulkSavePanel } from './RevenueBulkSavePanel';
import { BULK_SAVE_ENABLED } from '../services/revenue-import-save';
import { assessReportPeriods, findImportHeaders, parseReportPeriod } from '../services/revenue-import-excel';
import { flagDuplicateUids, splitImportBatches } from '../services/revenue-import-batch';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { agentService } from '../services/agent.service';
import { revenueCycleService } from '../services/revenue-cycle.service';
import './RevenueImportPreview.css';

type Platform = 'tiktok' | 'douyin';
type ServerResult = { row: unknown; uid?: unknown; platform?: unknown; status: string; creator_name?: unknown; cycle?: unknown; existing_amount?: unknown; difference?: unknown };
type ServerResponse = { data: { platform: string; start_date: string; end_date: string; period_no: number; results: ServerResult[] } | null; error: unknown };
type Row = { batchStart?: string; weekNo?: number; monthlyBase?: boolean; line: number; uid: string; amount: string; reportUsername?: string; reportPeriod?: string; reportPeriodParsed?: string; issue?: string; periodIssue?: string; name?: string; cycle?: string; period?: string; existing?: string; difference?: string; status: string; detail?: string };
type Batch = { fileName: string; start: string; end: string; periodKey: string; rows: Row[]; actualPeriod?: string; periodAbnormalCount?: number; periodBlocked?: boolean; verifiedThrough?: string; fileDigest?: string };
type Creator = { id: string; creator_name: string | null; platform_user_id: string | null; platform: Platform; status: string | null; membership_status: string | null };
const decimal = (s: string) => { if (!/^\d+(?:\.\d+)?$/.test(s)) return null; const [a,b=''] = s.split('.'); return `${BigInt(a)}${b.replace(/0+$/, '') ? '.' + b.replace(/0+$/, '') : ''}`; };
const diff = (a: string, b: string) => { const places = Math.max((a.split('.')[1] || '').length, (b.split('.')[1] || '').length); const scaled = (v: string) => { const [i,f=''] = v.split('.'); return BigInt(i + f.padEnd(places,'0')); }; const n = scaled(a)-scaled(b); const sign=n<0n?'-':''; const s=(n<0n?-n:n).toString().padStart(places+1,'0'); return sign + (places ? `${s.slice(0,-places)}.${s.slice(-places)}` : s); };
const add = (a: string, b: string) => { const places=Math.max((a.split('.')[1] || '').length,(b.split('.')[1] || '').length); const scaled=(v:string)=>{const [i,f='']=v.split('.');return BigInt(i+f.padEnd(places,'0'));}; const n=(scaled(a)+scaled(b)).toString().padStart(places+1,'0'); return decimal(places ? `${n.slice(0,-places)}.${n.slice(-places)}` : n)!; };
const cellText = (cell: XLSX.CellObject | undefined) => cell == null ? '' : String(cell.v ?? '').trim();
const malaysiaToday = () => { const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); return ['year','month','day'].map(type=>parts.find(part=>part.type===type)?.value).join('-'); };

export function RevenueImportPreview({ onClose, onSaved, demo = false }: { onClose: () => void; onSaved?: () => void; demo?: boolean }) {
  const [platform,setPlatform]=useState<Platform | ''>(''); const [start,setStart]=useState(''); const [end,setEnd]=useState(''); const [confirmed,setConfirmed]=useState(false);
  const [batches,setBatches]=useState<Batch[]>([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [search,setSearch]=useState(''); const [filter,setFilter]=useState('');
  const [verifiedThrough,setVerifiedThrough]=useState(''); const [replacementNotice,setReplacementNotice]=useState('');
  const requestVersion=useRef(0);
  useEffect(() => () => { requestVersion.current++; }, []);
  function invalidateResults() { requestVersion.current++; setBatches([]); setError(''); setReplacementNotice('条件已更改，请重新选择文件进行核对。'); }
  const rows=useMemo(() => {
    const flat=batches.flatMap(batch=>batch.rows);
    return flat.map(row=>{
      if (!row.monthlyBase || !row.weekNo) return row;
      const pieces=flat.filter(item=>item.monthlyBase && item.uid===row.uid && item.weekNo).sort((a,b)=>a.weekNo!-b.weekNo!);
      const total=pieces.reduce((sum,item)=>add(sum,decimal(item.amount)!), '0');
      const weeks=new Set(pieces.map(item=>item.weekNo!)); const max=Math.max(...weeks);
      const missing=Array.from({length:max},(_,i)=>i+1).filter(week=>!weeks.has(week));
      const basis=pieces.map(item=>`第${item.weekNo}周 ${item.amount}`).join(' + ');
      const old=row.existing && row.existing!=='—' ? decimal(row.existing) : null;
      const delta=old ? diff(total,old) : undefined;
      const comparison=old ? `；现有月流水 ${old}，差额 ${delta}（仅比较，不叠加）` : '';
      return {...row, difference:delta, status: demo ? (missing.length?'部分月累计，待核对':old ? (delta === '0' ? '已填写一致' : '数值冲突') : '可导入') : row.status, detail:`${missing.length ? '部分月累计，待核对；缺少第 '+missing.join('、')+' 周' : demo ? '累计预览（模拟数据）' : '累计预览，匹配范围待核验'}；累计 ${total}（${basis}）${comparison}`};
    });
  },[batches,demo]);
  const saveCount=rows.filter(row=>row.status==='未填写／待保存前复核').length;
  const visible=useMemo(()=>rows.filter(r=>(!filter||r.status===filter)&&`${r.uid} ${r.name || ''} ${r.reportUsername || ''} ${r.status} ${r.detail || ''}`.toLowerCase().includes(search.toLowerCase())),[rows,filter,search]);
  async function read(file: File) {
    const requestId=++requestVersion.current;
    const isCurrent=()=>requestVersion.current===requestId;
    setError(''); setReplacementNotice('');
    if (!platform || !start || !end || start>end) { setError('请先选择平台及有效的起止日期。'); return; }
    if (platform==='tiktok' && Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) !== 6 * 86400000) { setError('TikTok 批量导入仅支持完整七天周期。'); return; }
    if (batches.some(batch=>batch.start.slice(0,7)!==start.slice(0,7))) { setError('同一次预览只能添加同一月份的报表。'); return; }
    if (platform!=='tiktok' && batches.some(batch=>batch.start===start)) { setBatches(current=>current.filter(batch=>batch.start!==start)); setError('原报表已移除，请重新选择文件进行核对。'); return; }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setBatches([]); setError('请选择 .xlsx、.xls 或 .csv 文件；请重新选择文件核对。'); return; }
    const replacing=platform==='tiktok' && batches.some(batch=>batch.start===start);
    const otherBatches=replacing ? batches.filter(batch=>batch.start!==start) : batches;
    setBatches(otherBatches.filter(batch=>batch.start!==start));
    if(replacing) setReplacementNotice('已移除该周期旧预览；新文件核对完成后才会显示新结果。');
    setBusy(true);
    try {
      if (!demo) {
        const authorization = await (supabase as any).rpc('can_preview_creator_revenue_import', { p_action: 'use' });
        if (authorization.error || authorization.data !== true) throw new Error('服务器核对权限不可用或未明确授权；未解析文件。');
      }
      const fileBytes=await file.arrayBuffer();
      let fileDigest: string | undefined;
      if (globalThis.crypto?.subtle) { try { const hash=await crypto.subtle.digest('SHA-256',fileBytes); fileDigest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''); } catch { /* Preview stays available without a digest. */ } }
      const wb=XLSX.read(fileBytes,{type:'array',raw:true,cellFormula:true});
      const sheet=wb.Sheets[wb.SheetNames[0]]; if (!sheet || !sheet['!ref']) throw new Error('文件没有可读取的数据。');
      const range=XLSX.utils.decode_range(sheet['!ref']); if ((range.e.r-range.s.r)>100000 || (range.e.c-range.s.c)>500) throw new Error('文件范围过大，请检查报表。');
      const headers=findImportHeaders(sheet,range,platform);
      let parsed: Row[]=[];
      const reportPeriods: ReturnType<typeof parseReportPeriod>[] = [];
      for(let r=headers.row+1;r<=range.e.r;r++) { const id=sheet[XLSX.utils.encode_cell({r,c:headers.uid})], val=sheet[XLSX.utils.encode_cell({r,c:headers.amount})]; const uid=cellText(id), amount=cellText(val); if(!uid&&!amount) continue; let issue='';
        const reportUsername=headers.username == null ? '' : cellText(sheet[XLSX.utils.encode_cell({r,c:headers.username})]);
        if(!uid) issue='UID 为空'; else if(id?.t!=='s' || id.f || /[eE][+-]?\d/.test(uid)) issue='UID 不是可靠的文本，数字精度无法确认；请使用文本格式导出的原始报表';
        if(!amount || !decimal(amount) || val?.f || (val?.t==='n' && (!Number.isSafeInteger(val.v) || !Number.isFinite(val.v)))) issue=[issue,'金额为空、格式无效或数字精度无法确认'].filter(Boolean).join('；');
        const periodCell=platform==='tiktok' ? sheet[XLSX.utils.encode_cell({r,c:headers.period})] : undefined;
        const reportPeriod=platform==='tiktok' ? parseReportPeriod(periodCell, !!wb.Workbook?.WBProps?.date1904) : undefined;
        if(reportPeriod) reportPeriods.push(reportPeriod);
        parsed.push({line:r+1,uid,amount,reportUsername,reportPeriod:reportPeriod?.raw,reportPeriodParsed:reportPeriod?.start && reportPeriod.end ? `${reportPeriod.start} 至 ${reportPeriod.end}` : undefined,issue,status:'数据异常'});
        if (parsed.length + otherBatches.reduce((total,batch)=>total+batch.rows.length,0) > 500) throw new Error('单次最多支持 500 行，请拆分报表后重新选择。');
      }
      if (!parsed.length) throw new Error('文件没有可核对的数据行。');
      const periodAssessment=platform==='tiktok' ? assessReportPeriods(reportPeriods,start,end) : undefined;
      if(periodAssessment) parsed=parsed.map((row,index)=>{
        const periodIssue=periodAssessment.issues[index];
        return {...row,periodIssue,issue:[row.issue,periodIssue].filter(Boolean).join('；') || undefined,status:periodIssue?'周期异常':row.status};
      });

      parsed = flagDuplicateUids(parsed);
      const month=start.slice(0,7); const last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate(); const settings=demo ? (month==='2026-11' ? [1,2,3,4,5] : [1,2,3,4]).map((periodNo)=>({periodNo, isEnabled:true, startDate:`${month}-${String(1+(periodNo-1)*7).padStart(2,'0')}`, endDate:`${month}-${String(periodNo===(month==='2026-11'?5:4)?last:periodNo*7).padStart(2,'0')}`})) : await agentService.listRevenuePeriodSettings(month); const periods=settings.filter(p=>p.isEnabled).sort((a,b)=>a.startDate.localeCompare(b.startDate)); const match=periods.filter(p=>p.startDate===start && p.endDate===end);
      const consistent=start.slice(0,7)===end.slice(0,7) && match.length===1 && new Set(periods.map(p=>p.periodNo)).size===periods.length && periods.every((p,i)=>p.startDate.slice(0,7)===month && p.endDate.slice(0,7)===month && p.startDate<=p.endDate && (!i || periods[i-1].endDate<p.startDate));
      const periodKey=JSON.stringify(periods.map(p=>[p.periodNo,p.startDate,p.endDate])); if(otherBatches.some(batch=>batch.periodKey!==periodKey || (start<=batch.end && end>=batch.start))) throw new Error('周期设置发生变化或日期重叠；请移除已有报表后重新核对。');
      if (!demo) {
        const result: Row[] = parsed.map(r => ({...r, batchStart:start, weekNo:match[0]?.periodNo,
          period:match[0] ? `第${match[0].periodNo}周 ${start} 至 ${end}` : `${start} 至 ${end}`, detail:r.issue}));
        if(periodAssessment?.blocked) {
          for(const row of result) if(!row.periodIssue) { row.status='周期异常'; row.detail=[row.issue,'本文件存在周期异常，本次未进行服务器匹配'].filter(Boolean).join('；'); }
        }
        const valid = periodAssessment?.blocked ? [] : parsed.map((r,index)=>({r,index})).filter(({r})=>!r.issue);
        for(const chunk of splitImportBatches(valid)) {
          const {data,error:rpcError}: ServerResponse = await (supabase as any).rpc('preview_creator_revenue_import_v1', {
            p_platform:platform, p_start:start, p_end:end, p_timezone_confirmed:confirmed,
            p_rows:chunk.map(({r})=>({uid:r.uid,amount:r.amount})),
          });
          if(rpcError) throw new Error('服务器只读核对不可用或未获权限；所有分批结果未完成，请检查接口和授权。');
          if(!data || data.platform!==platform || data.start_date!==start || data.end_date!==end || !Array.isArray(data.results) || data.results.length!==chunk.length || !Number.isInteger(data.period_no) || data.period_no!==match[0]?.periodNo) throw new Error('服务器核对结果不完整或周期不一致，请重新核对。');
          const seen=new Set<number>();
          for(const item of data.results) {
            const pos=Number(item.row); if(!Number.isInteger(pos)||pos<1||pos>chunk.length||seen.has(pos)) throw new Error('服务器返回的行号无效或重复。');
            seen.add(pos); const {r,index}=chunk[pos-1];
            if(item.uid != null && (item.uid!==r.uid || item.platform!==platform)) throw new Error('服务器返回的主播身份不一致。');
            const map:Record<string,[string,string]>={
              data_invalid:['数据异常','数据格式或精度无效'], duplicate_file_uid:['数据异常','服务器检测到重复 UID'],
              identity_or_scope_unverified:['UID 异常','UID、归属或授权范围无法确认'], cycle_or_timezone_unverified:['周期异常',!confirmed ? '尚未确认平台报表时区与所选周期一致' : '服务器无法确认该主播的历史流水周期，或其周期不支持周／月流水'],
              monthly_week_detail_required:['周期异常','月度周明细需核验'], monthly_source_unverified:['周期异常','已有月流水来源待核验'],
              existing_period_ambiguous:['周期异常','已有记录周期不明确'], existing_equal:['已填写一致','与已有周流水一致，建议跳过'],
              existing_conflict:['数值冲突','与已有周流水不同，仅预览，不覆盖'], no_record_requires_write_recheck:['未填写／待保存前复核','已匹配主播，未发现该周期周流水；如将来开放保存，保存前仍须重新核验'],
            };
            const mapped=map[item.status]; if(!mapped) throw new Error('服务器返回未知核对状态。');
            result[index]={...result[index],name:typeof item.creator_name==='string'?item.creator_name:undefined,
              cycle:item.cycle==='weekly'?'按周':item.cycle==='monthly'?'按月':item.cycle==='none'?'无需填写':'待核验',
              monthlyBase:item.cycle==='monthly' && ['monthly_week_detail_required','monthly_source_unverified'].includes(item.status),
              existing:typeof item.existing_amount==='string'?item.existing_amount:'—',
              difference:typeof item.difference==='string'?item.difference:undefined,status:mapped[0],detail:mapped[1]};
          }
        }
        if (!isCurrent()) return;
        setBatches(current=>[...current,{fileName:file.name,start,end,periodKey,rows:result,actualPeriod:periodAssessment?.actual,periodAbnormalCount:periodAssessment?.abnormalCount,periodBlocked:periodAssessment?.blocked,verifiedThrough:platform==='tiktok'?verifiedThrough:undefined,fileDigest}]);
        return;
      }
      const all: Creator[]=demo ? [{id:'a',creator_name:'林小雨',platform_user_id:'tiktok_1001',platform:'tiktok',status:'active',membership_status:'active'},{id:'b',creator_name:'陈嘉',platform_user_id:'tiktok_1002',platform:'tiktok',status:'active',membership_status:'active'},{id:'c',creator_name:'周乐',platform_user_id:'douyin_2001',platform:'douyin',status:'active',membership_status:'active'},{id:'d',creator_name:'许晴',platform_user_id:'douyin_2002',platform:'douyin',status:'active',membership_status:'active'}] : []; if(!demo) for(let offset=0;;offset+=500) { const {data,error:err}=await (supabase as any).from('creator_profiles').select('id,creator_name,platform_user_id,platform,status,membership_status').order('id').range(offset,offset+499); if(err) throw err; all.push(...(data||[])); if((data||[]).length<500) break; }
      const ids=all.filter(c=>c.platform===platform && parsed.some(r=>r.uid===c.platform_user_id)).map(c=>c.id);
      const contexts=demo ? ids.map(id=>({creator_profile_id:id,effective_cycle:(id==='b'||id==='c'?'monthly':'weekly') as 'monthly'|'weekly',cycle_source:'VERIFIED' as const,can_write:true,monthly_record:id==='b' ? {id:'mock',creator_profile_id:id,revenue_month:month,platform:'tiktok' as const,revenue_amount:3000,revenue_unit:'diamond' as const,agent_note:null,version:1} : null})) : await revenueCycleService.monthContext(ids,month); const contextMap=new Map(contexts.map(c=>[c.creator_profile_id,c]));
      const records=demo ? [{creator_profile_id:platform==='tiktok'?'a':'d',revenue_amount:1000}] : consistent ? (await Promise.all(Array.from({length:Math.ceil(ids.length/500)},(_,i)=>agentService.listWeeklyRevenueRecords({creatorProfileIds:ids.slice(i*500,i*500+500),weekStartDate:start})))).flat() : [];
      const result=parsed.map(r=>{ const row={...r,batchStart:start,weekNo:match[0]?.periodNo,period:match[0] ? `第${match[0].periodNo}周 ${start} 至 ${end}` : `${start} 至 ${end}`}; if(r.issue) return {...row,detail:r.issue};
        const found=all.filter(c=>c.platform===platform && c.platform_user_id===r.uid); if(found.length!==1 || (found[0].status!=='active' || found[0].membership_status!=='active')) return {...row,status:'UID 异常',detail:found.length>1?'系统 UID 重复':found.length===1?'账号状态或归属不明确':all.some(c=>c.platform_user_id===r.uid)?'可见范围内 UID 属于其他平台；完整范围待核验':demo?'未找到 UID':'当前可见范围内未找到 UID；权限范围待核验，不能确认不存在'};
        const creator=found[0], ctx=contextMap.get(creator.id); row.name=creator.creator_name || '—'; row.cycle=ctx?.effective_cycle==='weekly'?'按周':ctx?.effective_cycle==='monthly'?'按月':ctx?.effective_cycle==='none'?'无需填写':'待核验';
        if(!consistent || !confirmed) return {...row,status:'周期异常',detail:!consistent?'日期未精确对应唯一有效周期，或周期设置重叠':'请确认平台报表时区与公司周期完全一致'};
        if(!ctx || ctx.cycle_source==='LEGACY_UNKNOWN' || ctx.cycle_source==='LEGACY_CURRENT_WEEKLY' || !ctx.effective_cycle) return {...row,status:'周期异常',detail:'当月有效周期未核验'};
        if(ctx.effective_cycle==='none' || !ctx.can_write) return {...row,status:'周期异常',detail:ctx.effective_cycle==='none'?'该主播无需填写流水':'当前周期不可填写，跳过'};
        if(ctx.effective_cycle==='monthly') { const old=ctx.monthly_record?.revenue_amount; if(old != null && !Number.isSafeInteger(old)) return {...row,existing:String(old),status:'数据异常',detail:'现有月流水精度无法确认'}; return {...row,monthlyBase:true,existing:old == null ? '—' : String(old),status:'周期异常',detail:'按本次报表计算，范围待核验'}; }
        const record=records.find(x=>x.creator_profile_id===creator.id); if(!record) return {...row,existing:'—',status:demo?'可导入':'周期异常',detail:demo?'模拟数据，仅预览':'匹配范围待核验；周流水 RLS 可能隐藏其他经纪人的草稿，未读到不代表不存在'};
        const old=String(record.revenue_amount), a=decimal(r.amount), b=decimal(old); if(!a || !b || !Number.isSafeInteger(record.revenue_amount)) return {...row,existing:old,status:'数据异常',detail:'现有数值精度无法确认'};
        const delta=diff(a,b); return {...row,existing:old,difference:delta,status:demo?(decimal(delta.replace('-',''))==='0'?'已填写一致':'数值冲突'):'周期异常',detail:(decimal(delta.replace('-',''))==='0'?'已读取数值一致':'已读取数值冲突')+(demo?'；模拟数据':'；匹配范围待核验，仅预览')};
      }); if (!isCurrent()) return; setBatches(current=>[...current,{fileName:file.name,start,end,periodKey,rows:result,actualPeriod:periodAssessment?.actual,periodAbnormalCount:periodAssessment?.abnormalCount,periodBlocked:periodAssessment?.blocked,verifiedThrough:platform==='tiktok'?verifiedThrough:undefined,fileDigest}]);
    } catch(e) { if (isCurrent()) setError(`无法完成核对：${e instanceof Error?e.message:String(e)}`); } finally { if (isCurrent()) setBusy(false); }
  }
  return <div className="revenue-import-overlay"><section className="revenue-import-dialog" role="dialog" aria-modal="true" aria-label="批量导入流水预览"><header><h2>批量导入流水</h2><button type="button" onClick={onClose}>关闭</button></header><p className="revenue-import-notice">{BULK_SAVE_ENABLED ? '文件仅在浏览器内临时解析。恢复原请求时，请使用同一账号、相同报表和截止日期。' : '目前仅支持批量核对，正式批量保存尚未开放。文件仅在浏览器内临时解析，关闭窗口后清除。'}</p><div className="revenue-import-form"><label>平台<select disabled={busy} value={platform} onChange={e=>{invalidateResults();setPlatform(e.target.value as Platform | '');setConfirmed(false);setVerifiedThrough('')}}><option value="">请选择</option><option value="tiktok">TikTok</option><option value="douyin">抖音</option></select></label><label>开始日期<input type="date" disabled={busy} value={start} onChange={e=>{invalidateResults();setStart(e.target.value);setConfirmed(false);setVerifiedThrough('')}} /></label><label>结束日期<input type="date" disabled={busy} value={end} onChange={e=>{invalidateResults();setEnd(e.target.value);setConfirmed(false);setVerifiedThrough('')}} /></label></div>{platform==='tiktok' ? <label className="revenue-import-verified">人工核实的 TikTok 数据截止日期 <small>请在选择文件前填写；此日期由操作人提供，并非 Excel 日期证据或服务器认证。</small><input type="date" disabled={busy} max={malaysiaToday()} value={verifiedThrough} onChange={e=>{invalidateResults();setVerifiedThrough(e.target.value)}} /></label> : null}{platform==='tiktok' && end && malaysiaToday()<end ? <p className="form-alert">系统所选周期尚未结束，本次仅供只读核对，不是最终流水。</p> : null}<label className="revenue-import-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>{invalidateResults();setConfirmed(e.target.checked)}} />我已核实平台报表的日期及统计时区与 DY Group 所选周期完全一致（勾选后选择文件）</label><div className="revenue-import-file"><label className={`revenue-import-file-button ${!platform||!start||!end||busy ? 'is-disabled' : ''}`}>选择 Excel / CSV 文件<input type="file" accept=".xlsx,.xls,.csv" disabled={!platform||!start||!end||busy} onChange={e=>{const f=e.target.files?.[0]; if(f) { void read(f); } e.target.value='';}} /></label><span>仅识别首个工作表；已解析文件显示在下方。</span></div><p>平台：{platform==='tiktok'?'TikTok':platform==='douyin'?'抖音':'未选择'}　待添加日期：{start || '—'} 至 {end || '—'}。抖音日期由操作人确认。仅识别首个工作表。</p>{demo ? <p className="revenue-import-notice">本地模拟数据，不连接数据库。2026 年 11 月周期为 1–7、8–14、15–21、22–28、29–30；其他月份沿用模拟周期。请使用页面提供的示例文件。</p> : <p className="form-alert">整份文件先检查重复 UID，再分批服务器核对；任一分批失败则不生成本次预览。跨批次查重由本地完成，正式保存前仍须服务端全批次复核。</p>}{batches.map(batch=><div className="revenue-import-batch" key={batch.start}><strong>已解析文件：{batch.fileName}</strong><p>系统所选周期：{batch.start} 至 {batch.end}；Excel 日期证据：{batch.actualPeriod ?? '未能从 Excel 确认'}{platform==='tiktok' ? `；TikTok 截止日期（人工核实，非服务器认证）：${batch.verifiedThrough || '未提供，完整性无法确认'}${batch.verifiedThrough && batch.verifiedThrough < batch.end ? '；数据尚未完整' : ''}${malaysiaToday()<batch.end ? '；本周尚未结束' : ''}；仅供只读核对，非最终流水` : ''}{batch.periodBlocked ? `；周期异常 ${batch.periodAbnormalCount} 行，本次未进行服务器匹配` : ''}（{batch.rows.length} 行）</p><button type="button" disabled={busy} onClick={()=>setBatches(current=>current.filter(item=>item.start!==batch.start))}>移除该周</button></div>)}{replacementNotice?<p role="status">{replacementNotice}</p>:null}{busy?<p>正在本地解析并读取系统记录…</p>:null}{error?<p className="form-alert">{error}</p>:null}{rows.length>0?<><div className="revenue-import-stats" aria-label="核对统计">{[['总记录',rows.length],['可新增（待复核）',saveCount],['已存在（一致）',rows.filter(r=>r.status==='已填写一致').length],['金额冲突',rows.filter(r=>r.status==='数值冲突').length],['无法匹配',rows.filter(r=>r.status==='UID 异常').length],['周期异常',rows.filter(r=>['周期异常','部分月累计，待核对'].includes(r.status)).length],['其他数据异常',rows.filter(r=>r.status==='数据异常').length],...(demo ? [['模拟可导入',rows.filter(r=>r.status==='可导入').length] as const] : [])].map(([label,count])=><div className="revenue-import-stat" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>{!BULK_SAVE_ENABLED ? <div className="revenue-import-save-bar"><button type="button" disabled>确认保存</button><span>本地仅供核对，正式批量保存尚未开放。</span></div> : null}<div className="revenue-import-filters"><input placeholder="搜索主播、UID、状态或原因" value={search} onChange={e=>setSearch(e.target.value)} /><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部状态</option>{['未填写／待保存前复核','可导入','已填写一致','数值冲突','UID 异常','周期异常','数据异常','部分月累计，待核对'].map(x=><option key={x}>{x}</option>)}</select></div><div className="revenue-import-table"><table><thead><tr>{['行','主播','平台','UID','计算方式','周期','Excel 金额','系统金额','差额（Excel − 系统）','状态 / 原因'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{visible.map(r=><tr className={r.status==='数值冲突' ? 'is-conflict' : undefined} key={`${r.batchStart}:${r.line}`}><td>{r.line}</td><td>{r.name||'—'}{r.reportUsername ? <><br/><small>报表用户名：{r.reportUsername}</small></> : null}</td><td>{platform==='tiktok'?'TikTok':'抖音'}</td><td>{r.uid||'—'}</td><td>{r.cycle||'—'}</td><td>系统所选：{r.period||'—'}<br/>Excel 声明：{r.reportPeriodParsed||'无法确认'}<br/>原始单元格：{r.reportPeriod||'空'}</td><td>{r.amount||'—'}</td><td>{r.existing||'—'}</td><td>{r.difference||'—'}</td><td>{r.status}<br/>{r.detail}</td></tr>)}</tbody></table></div><div className="revenue-import-cards">{visible.map(r=><article className={r.status==='数值冲突' ? 'is-conflict' : undefined} key={`${r.batchStart}:${r.line}`}><strong>{r.name||'未匹配'} · {r.status}</strong><p>{platform==='tiktok'?'TikTok':'抖音'} · UID {r.uid||'—'} · 第 {r.line} 行</p>{r.reportUsername ? <p>报表用户名：{r.reportUsername}</p> : null}<p>{r.cycle||'—'} · 系统所选：{r.period}</p><p>Excel 声明周期：{r.reportPeriodParsed||'无法确认'}（原始单元格：{r.reportPeriod||'空'}）</p><p>Excel 金额：{r.amount||'—'}　系统金额：{r.existing||'—'}　差额（Excel − 系统）：{r.difference||'—'}</p><p>原因：{r.detail||'—'}</p></article>)}</div>{!demo && confirmed && platform==='tiktok' && batches.length===1 && batches[0].start===start && batches[0].end===end && batches[0].verifiedThrough===verifiedThrough && !batches[0].periodBlocked && batches[0].fileDigest && batches[0].verifiedThrough && batches[0].rows.length>0 && batches[0].rows.length<=500 && batches[0].rows.every(r=>!r.issue && /^\d{1,12}(?:\.\d{1,2})?$/.test(r.amount)) ? <RevenueBulkSavePanel key={`${start}:${end}:${batches[0].fileDigest}:${verifiedThrough}`} report={{platform,periodStart:start,periodEnd:end,fileSha256:batches[0].fileDigest,verifiedThrough,rows:batches[0].rows.map(r=>({uid:r.uid,amount:r.amount}))}} onSaved={onSaved} /> : null}</>:null}</section></div>;
}
