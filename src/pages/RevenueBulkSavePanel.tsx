import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readRequest, recoveryKeyForActor } from '../services/revenue-import-recovery';
import { BULK_SAVE_ENABLED, preflightRevenueImport, saveRevenueImport, type RevenueBulkReport, type RevenueBulkRowResult, type RevenueEligibility } from '../services/revenue-import-save';

async function recoveryKey(report: RevenueBulkReport): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('无法确认登录身份，暂不能保存。');
  return recoveryKeyForActor(data.user.id, report);
}

export function RevenueBulkSavePanel({ report, onSaved }: { report: RevenueBulkReport; onSaved?: () => void }) {
  const [eligibility,setEligibility]=useState<RevenueEligibility[] | null>(null);
  const [selected,setSelected]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  const [open,setOpen]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [requestId,setRequestId]=useState<string | null>(null);
  const [key,setKey]=useState<string | null>(null);
  const [ready,setReady]=useState(false);
  const [results,setResults]=useState<RevenueBulkRowResult[] | null>(null);
  const [error,setError]=useState('');
  useEffect(() => {
    if (!BULK_SAVE_ENABLED) return;
    let active = true;
    void recoveryKey(report).then(storageKey => {
      const pending = readRequest(storageKey, report);
      if (!active) return;
      setKey(storageKey);
      if (pending) { setRequestId(pending.requestId); setSelected(pending.selected); setConfirmed(true); }
      setReady(true);
    }).catch(() => { if (active) setError('无法读取恢复记录，请检查登录及浏览器存储后重试。'); });
    return () => { active = false; };
  }, [report]);
  const eligible=useMemo(()=>eligibility?.filter(x=>x.status==='eligible').map(x=>x.uid) ?? [],[eligibility]);
  const total=useMemo(()=>{
    const sum=report.rows.filter(row=>selected.includes(row.uid)).reduce((n,row)=>{
      const [whole,decimal='']=row.amount.split('.');return n+BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'));
    },0n);
    return `${sum/100n}.${String(sum%100n).padStart(2,'0')}`;
  },[report,selected]);
  async function preflight() {
    if(inFlight.current || !ready) return; inFlight.current=true;
    setBusy(true);setError('');setEligibility(null);setSelected([]);setResults(null);
    try { setEligibility(await preflightRevenueImport(report)); }
    catch(e) { setError(e instanceof Error?e.message:'资格核对失败。'); }
    finally { inFlight.current=false; setBusy(false); }
  }
  async function save() {
    if(inFlight.current || busy || !confirmed || !selected.length || !key || !ready) return;
    inFlight.current=true; setBusy(true);setError('');
    try {
      if (await recoveryKey(report) !== key) throw new Error('登录身份已变更，请重新打开报表。');
      const previous=readRequest(key,report);
      if (previous && (requestId && previous.requestId!==requestId || JSON.stringify(previous.selected)!==JSON.stringify(selected))) throw new Error('已有不同的待恢复请求，请重新打开报表核对。');
      const id=previous?.requestId ?? requestId ?? crypto.randomUUID();
      // Persist before sending; if storage fails, no write is sent.
      localStorage.setItem(key,JSON.stringify({requestId:id,selected}));
      const stored=readRequest(key,report);
      if (!stored || stored.requestId!==id || JSON.stringify(stored.selected)!==JSON.stringify(selected)) throw new Error('无法保存恢复记录，未发送请求。');
      setRequestId(id);
      const response=await saveRevenueImport(report,selected,id,true);
      setResults(response.results);setOpen(false);onSaved?.();
    } catch(e) { setError(e instanceof Error?e.message:'保存状态未知，请使用相同请求重试。'); }
    finally { inFlight.current=false; setBusy(false); }
  }
  if (!BULK_SAVE_ENABLED) return <p className="revenue-import-notice">正式批量保存尚未开放。</p>;
  return <div className="revenue-import-save-bar">
    {!requestId ? <button type="button" disabled={busy || !ready || !!results} onClick={()=>void preflight()}>服务器核对保存资格</button> : null}
    <span>可保存 {eligible.length} · 选中 {selected.length} · 金额 {total}</span>
    {requestId && !results ? <><p>发现相同报表的原请求。可恢复服务器结果；若请求尚未提交，将按原确认内容重试。</p><button type="button" disabled={busy || !ready} onClick={()=>setOpen(true)}>恢复原请求</button></> : null}
    {eligibility && !requestId ? <><label><input type="checkbox" disabled={busy || !eligible.length} checked={!!eligible.length && selected.length===eligible.length} onChange={e=>setSelected(e.target.checked?eligible:[])} /> 全选合格记录</label>
      <div>{eligibility.map(item=><label key={item.uid} style={{display:'block'}}><input type="checkbox" disabled={item.status!=='eligible' || busy} checked={selected.includes(item.uid)} onChange={e=>setSelected(old=>e.target.checked?[...old,item.uid]:old.filter(uid=>uid!==item.uid))} /> {item.uid} · {item.status} · {item.reason}</label>)}</div>
      <button type="button" disabled={busy || !selected.length || !!results} onClick={()=>setOpen(true)}>确认批量保存</button></> : null}
    {error ? <p role="alert">{error}</p> : null}
    {results ? <div role="status"><p>新增 {results.filter(r=>r.outcome==='saved').length} · 跳过 {results.filter(r=>r.outcome==='skipped').length} · 冲突 {results.filter(r=>r.outcome==='conflict').length} · 失败 {results.filter(r=>r.outcome==='failed').length}</p>{results.map(r=><p key={r.uid}>{r.uid}：{r.outcome} · {r.reason}</p>)}</div> : null}
    {open ? <div className="revenue-import-confirm-overlay"><section className="revenue-import-confirm-dialog" role="dialog" aria-modal="true" aria-label="确认批量保存"><h3>{requestId?'恢复原请求':'确认批量保存'}</h3><p>{report.platform==='tiktok'?'TikTok':'抖音'} · {report.periodStart} 至 {report.periodEnd}</p><p>主播 {selected.length} 人 · 金额 {total}</p><p>人工核实截止：{report.verifiedThrough}。平台数据可能延迟或缺漏；员工声明属于公司业务确认，并非平台认证。</p><label className="revenue-import-confirm"><input type="checkbox" disabled={busy || !!requestId} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> 我确认完整报表覆盖所选周期，平台数据已同步完整。</label>{error ? <p role="alert">{error}</p> : null}<div className="revenue-import-confirm-actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>返回</button><button type="button" disabled={busy || !confirmed} onClick={()=>void save()}>{busy?'处理中…':requestId?'恢复或重试原请求':'确认保存'}</button></div></section></div> : null}
  </div>;
}
