import { useEffect, useState } from 'react';
import { readReviewMode } from '../services/designer-review-mode';
import { DesignerReviewConnected, type ReviewConnectedProps } from './DesignerReviewConnected';
import { DesignerReviewWorkspace } from './DesignerReviewWorkspace';

export type Mode = 'unknown' | 'off' | 'active' | 'paused';
export async function getReviewStageMode(requestId:string, stageId:string, itemId:string):Promise<Mode> { return readReviewMode({ requestId, stageId, itemId }); }
export function useReviewStageMode(requestId:string,stageId:string | undefined,itemId:string | null | undefined):Mode { const key=stageId&&itemId ? requestId+':'+stageId+':'+itemId : ''; const [state,setState]=useState<{key:string;mode:Mode}>({key:'',mode:'unknown'}); useEffect(()=>{let alive=true,seq=0; const check=async()=>{const n=++seq;const mode=stageId&&itemId?await getReviewStageMode(requestId,stageId,itemId):'unknown';if(alive&&n===seq)setState({key,mode});};void check();const timer=window.setInterval(()=>void check(),15000);return()=>{alive=false;window.clearInterval(timer)}},[requestId,stageId,itemId,key]);return state.key===key?state.mode:'unknown'; }
/** Network failures do not imply legacy. */
export function DesignerReviewStageGate(props: ReviewConnectedProps) {
  const { requestId, stageId, itemId } = props;
  const mode = useReviewStageMode(requestId, stageId, itemId);
  if (mode === 'active' || mode === 'paused') return <DesignerReviewConnected {...props} paused={mode === 'paused'} />;
  return <DesignerReviewWorkspace role={props.role} status="draft" pictures={[]} note="" submittedNote={null}
    feedback={null} revisionCount={0} disabledReason={mode === 'off' ? '该设计阶段尚未启用方案 A。' : '无法确认该阶段的审核模式，请刷新后重试。'} />;
}
