import { useState, type ChangeEvent } from 'react';
import '../styles/designer-review-workspace.css';

export type ReviewPicture = { id: string; name: string; url: string };
export type ReviewStatus = 'draft' | 'review' | 'revision' | 'final';
export type DesignerReviewWorkspaceProps = {
  role: 'designer' | 'agent'; status: ReviewStatus; pictures: ReviewPicture[];
  note: string; submittedNote: string | null; feedback: string | null; revisionCount: number;
  handoff?: 'production' | 'complete'; disabledReason?: string;
  onAdd?: (files: File[]) => void; onReplace?: (picture: ReviewPicture, file: File) => void;
  onRemove?: (picture: ReviewPicture) => void; onNoteChange?: (note: string) => void;
  onSubmit?: () => void; onReturn?: (opinion: string) => void; onConfirm?: () => void;
};

export function DesignerReviewWorkspace(props: DesignerReviewWorkspaceProps) {
  const {role,status,pictures,feedback,revisionCount,disabledReason} = props;
  const editable = !disabledReason && role === 'designer' && (status === 'draft' || status === 'revision');
  const [zoom,setZoom]=useState<ReviewPicture|null>(null);
  const [dialog,setDialog]=useState<'return'|'confirm'|null>(null);
  const [opinion,setOpinion]=useState('');
  const [error,setError]=useState('');
  const files = (e:ChangeEvent<HTMLInputElement>, replace?:ReviewPicture) => {
    const chosen=Array.from(e.target.files||[]).filter(file=>file.type.startsWith('image/'));
    if (replace && chosen[0]) props.onReplace?.(replace,chosen[0]);
    else if (chosen.length) props.onAdd?.(chosen);
    e.target.value='';
  };
  return <section className="review-workspace">
    <p className="review-workspace-current-status">当前审核状态：{({draft:'待提交',review:'待审核',revision:'退回修改',final:'已定稿'} as const)[status]}</p>
    {feedback && <p className="review-workspace-feedback"><b>{status === 'revision' ? '本次退回意见：' : '上一次退回意见：'}</b>{feedback} · 修改 {revisionCount} 次</p>}
    {status==='final' && <p className="review-workspace-locked">🔒 已定稿 · {props.handoff==='production'?'待制作交接':props.handoff==='complete'?'纯设计已完成':'图片已锁定'}</p>}
    <div className="review-workspace-head"><div><h4>{status==='final'?'最终定稿图片':'当前设计图片'}</h4><small>{disabledReason || (status==='review'?'已提交，审核中只读':status==='revision'?'美工修改中':status==='final'?'图片已锁定':'添加、移除或替换图片')}</small></div>
      {role==='designer' && (status==='draft'||status==='revision') && <label className={'review-workspace-primary'+(!editable?' is-disabled':'')}>添加设计图片<input type="file" accept="image/*" multiple disabled={!editable||!props.onAdd} onChange={e=>files(e)}/></label>}</div>
    {pictures.length ? <div className="review-workspace-grid">{pictures.map(pic=><article key={pic.id}><button type="button" className="review-workspace-picture" onClick={()=>setZoom(pic)} aria-label={'放大预览 '+pic.name}><img src={pic.url} alt={pic.name}/></button><div><span title={pic.name}>{pic.name}</span>{editable?<><label>替换<input type="file" accept="image/*" aria-label={'替换 '+pic.name} disabled={!props.onReplace} onChange={e=>files(e,pic)}/></label><button type="button" disabled={!props.onRemove} onClick={()=>props.onRemove?.(pic)} aria-label={'移除 '+pic.name}>移除</button></>:<a href={pic.url} download={pic.name}>下载</a>}</div></article>)}</div>:<p className="review-workspace-empty">{status==='revision' && role==='agent'?'美工正在修改，重新提交后可查看。':'暂无设计图片'}</p>}
    {role==='designer'&&(status==='draft'||status==='revision')&&<><label className="review-workspace-note">提交备注（选填）<textarea value={props.note} disabled={!editable||!props.onNoteChange} onChange={e=>props.onNoteChange?.(e.target.value)} placeholder="例如：已调整标题与配色"/></label><button type="button" className="review-workspace-primary" disabled={!editable||!props.onSubmit} onClick={()=>{if(!pictures.length){setError('请先添加至少一张设计图片。');return}setError('');props.onSubmit?.()}}>提交审核</button></>}
    {role==='agent'&&(status==='review'||status==='final')&&<p>美工提交备注：{props.submittedNote ?? '暂未提供'}</p>}
    {role==='agent'&&status==='review'&&<div className="review-workspace-actions"><button type="button" disabled={!!disabledReason||!props.onReturn} onClick={()=>{setError('');setOpinion('');setDialog('return')}}>要求修改</button><button type="button" className="review-workspace-primary" disabled={!!disabledReason||!props.onConfirm} onClick={()=>setDialog('confirm')}>确认定稿</button></div>}
    {error&&!dialog&&<p role="alert">{error}</p>}
    {zoom&&<div className="review-workspace-overlay" onClick={()=>setZoom(null)}><div role="dialog" aria-label="图片预览" onClick={e=>e.stopPropagation()}><button onClick={()=>setZoom(null)}>关闭</button><img src={zoom.url} alt={zoom.name}/></div></div>}
    {dialog&&<div className="review-workspace-overlay"><div role="dialog" aria-label={dialog==='return'?'要求修改':'确认定稿'}><h3>{dialog==='return'?'要求修改':'确认设计定稿？'}</h3>{dialog==='return'?<><label>修改意见 *<textarea value={opinion} onChange={e=>setOpinion(e.target.value)} placeholder="请输入具体修改意见"/></label>{error&&<p role="alert">{error}</p>}<button onClick={()=>{if(!opinion.trim()){setError('请填写修改意见。');return}props.onReturn?.(opinion.trim());setDialog(null);setError('')}}>提交修改意见</button></>:<><p>确认后当前图片将锁定。</p><button className="review-workspace-primary" onClick={()=>{props.onConfirm?.();setDialog(null)}}>确认定稿</button></>}<button className="review-workspace-secondary" onClick={()=>{setDialog(null);setError('')}}>取消</button></div></div>}
  </section>;
}
