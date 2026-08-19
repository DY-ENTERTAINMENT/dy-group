import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Plus, RefreshCw, Send, X } from 'lucide-react';
import { MonthSelect } from '../components/MonthSelect';
import { SystemModal } from '../components/SystemModal';
import { useAuth } from '../hooks/useAuth';
import tiktokLogoUrl from '../assets/icons/tiktok-logo.png';
import douyinLogoUrl from '../assets/icons/douyin-logo.png';
import {
  adjustmentStatusLabels,
  adjustmentTypeLabels,
  agentService,
  createRevenueBreakdown,
  creatorTypeLabels,
  designStatusLabels,
  designTypeLabels,
  formatMoney,
  getEmployeeName,
  platformLabels,
  printMethodLabels,
  type AdjustmentFormValues,
  type AdjustmentRequest,
  type AdjustmentType,
  type AgentOptions,
  type DesignFormValues,
  type DesignRequest,
  type DesignRequestType,
  type RevenueRecord,
} from '../services/agent.service';
import type { CreatorPlatform, CreatorProfile } from '../services/scout.service';

export type AgentPageMode = 'revenue' | 'creators' | 'adjustments' | 'design-requests' | 'management-revenue';

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

const emptyAdjustment: AdjustmentFormValues = {
  platform: 'tiktok',
  platform_user_id: '',
  request_type: 'to_online',
  effective_date: today,
  full_name: '',
  bank_name: '',
  bank_account: '',
  target_nickname: '',
  target_email: '',
  content: '',
};

const emptyDesign: DesignFormValues = {
  request_type: 'banner',
  platform: 'tiktok',
  platform_user_id: '',
  creator_name: '',
  platform_account: '',
  fan_nickname: '',
  fan_level: '',
  design_content: '',
  design_elements: '',
  print_method: 'print',
  special_content: '',
  reference_urls: '',
};

const adjustmentTypes: AdjustmentType[] = ['to_online', 'to_company', 'to_5_1', 'change_manager', 'change_scout', 'change_bank', 'special'];
const designTypes: DesignRequestType[] = ['banner', 'standee', 'poster', 'special'];

export function AgentPage({ mode }: { mode: AgentPageMode }) {
  const { profile } = useAuth();
  const isManagement = mode === 'management-revenue';
  const [options, setOptions] = useState<AgentOptions>({ regions: [], employees: [], currentEmployee: null });
  const [month, setMonth] = useState(currentMonth);
  const [platform, setPlatform] = useState('tiktok');
  const [regionId, setRegionId] = useState('');
  const [revenues, setRevenues] = useState<RevenueRecord[]>([]);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRequest[]>([]);
  const [designRequests, setDesignRequests] = useState<DesignRequest[]>([]);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentFormValues>(emptyAdjustment);
  const [designForm, setDesignForm] = useState<DesignFormValues>(emptyDesign);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [designModalOpen, setDesignModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const revenueBreakdown = useMemo(() => createRevenueBreakdown(revenues), [revenues]);
  const pendingAdjustments = adjustments.filter((item) => item.status === 'pending').length;
  const unclaimedDesigns = designRequests.filter((item) => item.status === 'unclaimed').length;
  const inProgressDesigns = designRequests.filter((item) => item.status === 'in_progress' || item.status === 'revision').length;

  useEffect(() => {
    void loadData();
  }, [mode, profile?.id, month, platform, regionId]);

  async function loadData() {
    if (!profile?.id && !isManagement) return;
    setLoading(true);
    setError('');
    try {
      const nextOptions = await agentService.getOptions(profile?.id);
      setOptions(nextOptions);
      const defaultRegion = regionId || nextOptions.currentEmployee?.region_id || '';
      if (!regionId && nextOptions.currentEmployee?.region_id && mode === 'creators') setRegionId(nextOptions.currentEmployee.region_id);

      if (mode === 'revenue' || mode === 'management-revenue') {
        setRevenues(await agentService.listRevenueData({ profileId: profile?.id, month, platform, regionId: defaultRegion, management: isManagement }));
      }
      if (mode === 'creators' && profile?.id) {
        setCreators(await agentService.listManagedCreators(profile.id, { month, platform, regionId: defaultRegion }));
      }
      if (mode === 'adjustments' && profile?.id) {
        setAdjustments(await agentService.listAdjustments(profile.id));
      }
      if (mode === 'design-requests' && profile?.id) {
        setDesignRequests(await agentService.listDesignRequests({ profileId: profile.id, mode: 'agent' }));
      }
    } catch (loadError) {
      setError(`读取经纪人资料失败：${getErrorMessage(loadError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await agentService.createAdjustment(profile.id, adjustmentForm);
      setMessage('资料调整申请已提交。');
      setAdjustmentModalOpen(false);
      setAdjustmentForm(emptyAdjustment);
      await loadData();
    } catch (saveError) {
      setError(`提交申请失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await agentService.createDesignRequest(profile.id, designForm);
      setMessage('美工申请已提交。');
      setDesignModalOpen(false);
      setDesignForm(emptyDesign);
      await loadData();
    } catch (saveError) {
      setError(`提交美工申请失败：${getErrorMessage(saveError)}`);
    } finally {
      setSaving(false);
    }
  }

  async function updateDesignStatus(request: DesignRequest, status: 'confirming' | 'revision' | 'ok' | 'cancelled') {
    const revisionNote = status === 'revision' ? window.prompt('请输入调整内容') ?? '' : undefined;
    setError('');
    try {
      await agentService.updateDesignStatus(request.id, status, { revisionNote });
      await loadData();
    } catch (statusError) {
      setError(`更新美工申请失败：${getErrorMessage(statusError)}`);
    }
  }

  return (
    <section className="agent-page">
      <div className="toolbar-actions staff-actions-row">
        {mode === 'adjustments' ? (
          <button className="secondary-action" type="button" onClick={() => setAdjustmentModalOpen(true)}><Plus size={17} /><span>添加新申请</span></button>
        ) : null}
        {mode === 'design-requests' ? (
          <button className="secondary-action" type="button" onClick={() => setDesignModalOpen(true)}><Plus size={17} /><span>添加新申请</span></button>
        ) : null}
        <button className="secondary-action" type="button" onClick={loadData} disabled={loading}><RefreshCw size={17} /><span>刷新</span></button>
      </div>

      {error ? <p className="form-alert">{error}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}

      {mode === 'revenue' || mode === 'management-revenue' ? (
        <RevenuePanel isManagement={isManagement} loading={loading} month={month} platform={platform} regionId={regionId} options={options} breakdown={revenueBreakdown} onMonth={setMonth} onPlatform={setPlatform} onRegion={setRegionId} />
      ) : null}

      {mode === 'creators' ? (
        <CreatorDataPanel loading={loading} month={month} platform={platform} regionId={regionId} options={options} creators={creators} revenues={revenues} onMonth={setMonth} onPlatform={setPlatform} onRegion={setRegionId} />
      ) : null}

      {mode === 'adjustments' ? <AdjustmentPanel loading={loading} pendingCount={pendingAdjustments} adjustments={adjustments} /> : null}
      {mode === 'design-requests' ? <AgentDesignPanel loading={loading} unclaimed={unclaimedDesigns} inProgress={inProgressDesigns} requests={designRequests} onStatus={updateDesignStatus} /> : null}

      {adjustmentModalOpen ? <AdjustmentModal values={adjustmentForm} saving={saving} onChange={setAdjustmentForm} onClose={() => setAdjustmentModalOpen(false)} onSubmit={submitAdjustment} /> : null}
      {designModalOpen ? <DesignModal values={designForm} saving={saving} onChange={setDesignForm} onClose={() => setDesignModalOpen(false)} onSubmit={submitDesign} /> : null}
    </section>
  );
}

function RevenuePanel(props: {
  isManagement: boolean;
  loading: boolean;
  month: string;
  platform: string;
  regionId: string;
  options: AgentOptions;
  breakdown: ReturnType<typeof createRevenueBreakdown>;
  onMonth: (value: string) => void;
  onPlatform: (value: string) => void;
  onRegion: (value: string) => void;
}) {
  const showTikTok = !props.platform || props.platform === 'tiktok';
  const showDouyin = !props.platform || props.platform === 'douyin';

  return (
    <div className="staff-list-panel">
      <AgentFilters {...props} />
      <div className="scout-stat-grid agent-revenue-card-grid">
        {props.loading ? (
          <div className="table-state">正在统计流水...</div>
        ) : (
          <>
            {showTikTok ? <RevenueCard title="TikTok" summary={props.breakdown.tiktok} logoUrl={tiktokLogoUrl} unit="钻石" platform="tiktok" /> : null}
            {showDouyin ? <RevenueCard title="抖音" summary={props.breakdown.douyin} logoUrl={douyinLogoUrl} unit="音浪" platform="douyin" /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function RevenueCard({ title, summary, logoUrl, unit, platform }: { title: string; summary: { total: number; plusFiveOne: number; nonFiveOne: number }; logoUrl: string; unit: string; platform: 'tiktok' | 'douyin' }) {
  return (
    <section className={`scout-stat-card agent-revenue-card agent-revenue-card--${platform}`}>
      <h4 className="agent-revenue-card-title">
        <img src={logoUrl} alt="" aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <strong className="agent-revenue-card-total">
        <span>{formatRevenueAmount(summary.total)}</span>
        <small>{unit}</small>
      </strong>
      <div className="agent-revenue-card-breakdown">
        <div className="agent-revenue-card-metric">
          <span>5+1</span>
          <b>{formatRevenueAmount(summary.plusFiveOne)}</b>
        </div>
        <div className="agent-revenue-card-metric">
          <span>非5+1</span>
          <b>{formatRevenueAmount(summary.nonFiveOne)}</b>
        </div>
      </div>
    </section>
  );
}

function formatRevenueAmount(value: number) {
  return (Number(value) || 0).toLocaleString('en-MY', { maximumFractionDigits: 2 });
}

function AgentFilters(props: { month: string; platform: string; regionId: string; options: AgentOptions; onMonth: (value: string) => void; onPlatform: (value: string) => void; onRegion: (value: string) => void }) {
  return <div className="scout-filters"><label className="form-field"><span>年月份</span><MonthSelect value={props.month} onChange={props.onMonth} /></label><SelectField label="平台" value={props.platform} onChange={props.onPlatform}><option value="tiktok">TikTok</option><option value="douyin">抖音</option><option value="">全部</option></SelectField><SelectField label="区域" value={props.regionId} onChange={props.onRegion}><option value="">全部</option>{props.options.regions.map((region) => <option key={region.id} value={region.id}>{region.code}</option>)}</SelectField></div>;
}

function CreatorDataPanel(props: { loading: boolean; month: string; platform: string; regionId: string; options: AgentOptions; creators: CreatorProfile[]; revenues: RevenueRecord[]; onMonth: (value: string) => void; onPlatform: (value: string) => void; onRegion: (value: string) => void }) {
  return <div className="staff-list-panel"><AgentFilters {...props} />{props.loading ? <div className="table-state">正在读取主播数据...</div> : <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>ID</th><th>主播名字</th><th>KPI 天数</th><th>KPI 时长</th><th>KPI 流水</th><th>已达天数</th><th>已达时长</th><th>已达流水</th></tr></thead><tbody>{props.creators.map((creator) => { const revenue = props.revenues.find((item) => item.creator_profile_id === creator.id); return <tr key={creator.id}><td>{creator.platform_user_id}</td><td>{creator.creator_name}</td><td>{revenue?.kpi_days ?? 0}</td><td>{revenue?.kpi_hours ?? 0}</td><td>{formatMoney(revenue?.kpi_revenue ?? 0)}</td><td>{revenue?.achieved_days ?? 0}</td><td>{revenue?.achieved_hours ?? 0}</td><td>{formatMoney(revenue?.achieved_revenue ?? 0)}</td></tr>; })}</tbody></table></div>}</div>;
}

function AdjustmentPanel({ loading, pendingCount, adjustments }: { loading: boolean; pendingCount: number; adjustments: AdjustmentRequest[] }) {
  return <div className="staff-list-panel"><div className="agent-count-strip"><span>审核中 <b>{pendingCount}</b></span></div>{loading ? <div className="table-state">正在读取申请...</div> : <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>平台</th><th>主播</th><th>调整项目</th><th>申请日期</th><th>申请状态</th></tr></thead><tbody>{adjustments.map((item) => <tr key={item.id}><td>{platformLabels[item.platform]}</td><td>{item.creator?.creator_name ?? item.platform_user_id ?? '-'}</td><td>{adjustmentTypeLabels[item.request_type]}</td><td>{formatDate(item.created_at)}</td><td>{adjustmentStatusLabels[item.status]}</td></tr>)}</tbody></table></div>}</div>;
}

function AgentDesignPanel({ loading, unclaimed, inProgress, requests, onStatus }: { loading: boolean; unclaimed: number; inProgress: number; requests: DesignRequest[]; onStatus: (request: DesignRequest, status: 'confirming' | 'revision' | 'ok' | 'cancelled') => void }) {
  return <div className="staff-list-panel"><div className="agent-count-strip"><span>未接单 <b>{unclaimed}</b></span><span>制作中 <b>{inProgress}</b></span></div>{loading ? <div className="table-state">正在读取美工申请...</div> : <div className="staff-table-wrap"><table className="staff-table agent-table"><thead><tr><th>类型</th><th>主播</th><th>状态</th><th>美工</th><th>申请内容</th><th>操作</th></tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td>{designTypeLabels[item.request_type]}</td><td>{item.creator_name || item.platform_user_id || '-'}</td><td>{designStatusLabels[item.status]}</td><td>{getEmployeeName(item.designer) || '-'}</td><td>{item.design_content || item.special_content || '-'}</td><td><div className="row-actions"><button className="icon-button" type="button" onClick={() => onStatus(item, 'confirming')} aria-label="跟主播确认中"><Send size={16} /></button><button className="icon-button" type="button" onClick={() => onStatus(item, 'revision')} aria-label="调整申请"><RefreshCw size={16} /></button><button className="icon-button accept-button" type="button" onClick={() => onStatus(item, 'ok')} aria-label="OK"><Check size={16} /></button><button className="icon-button reject-button" type="button" onClick={() => onStatus(item, 'cancelled')} aria-label="取消"><X size={16} /></button></div></td></tr>)}</tbody></table></div>}</div>;
}

function AdjustmentModal({ values, saving, onChange, onClose, onSubmit }: { values: AdjustmentFormValues; saving: boolean; onChange: (values: AdjustmentFormValues) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const needsEffective = ['to_online', 'to_company', 'to_5_1', 'change_bank'].includes(values.request_type);
  const needsBank = ['to_company', 'to_5_1', 'change_bank'].includes(values.request_type);
  const needsTarget = values.request_type === 'change_manager' || values.request_type === 'change_scout';
  return <SystemModal title="添加新申请" ariaLabel="主播资料调整申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="adjustment-form" disabled={saving}>提交</button></>}><form id="adjustment-form" onSubmit={onSubmit}><div className="form-grid"><SelectField label="平台" value={values.platform} onChange={(value) => onChange({ ...values, platform: value as CreatorPlatform })}><option value="tiktok">TikTok</option><option value="douyin">抖音</option></SelectField><SelectField label="可申请项目" value={values.request_type} onChange={(value) => onChange({ ...values, request_type: value as AdjustmentType })}>{adjustmentTypes.map((type) => <option key={type} value={type}>{adjustmentTypeLabels[type]}</option>)}</SelectField>{values.request_type !== 'special' ? <TextField label={values.platform === 'tiktok' ? 'TikTok ID' : '抖音 UID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} required /> : null}{needsEffective ? <TextField label="生效日期" type="date" value={values.effective_date} onChange={(value) => onChange({ ...values, effective_date: value })} /> : null}{needsBank ? <><TextField label="全名" value={values.full_name} onChange={(value) => onChange({ ...values, full_name: value })} /><TextField label="银行" value={values.bank_name} onChange={(value) => onChange({ ...values, bank_name: value })} /><TextField label="银行户口" value={values.bank_account} onChange={(value) => onChange({ ...values, bank_account: value })} /></> : null}{needsTarget ? <><TextField label={values.request_type === 'change_manager' ? '经纪人昵称' : '星探昵称'} value={values.target_nickname} onChange={(value) => onChange({ ...values, target_nickname: value })} /><TextField label={values.request_type === 'change_manager' ? '经纪人后台 Email' : '星探后台 Email'} value={values.target_email} onChange={(value) => onChange({ ...values, target_email: value })} /></> : null}<label className="form-field form-field-wide"><span>特殊申请 / 备注</span><textarea value={values.content} onChange={(event) => onChange({ ...values, content: event.target.value })} /></label></div></form></SystemModal>;
}

function DesignModal({ values, saving, onChange, onClose, onSubmit }: { values: DesignFormValues; saving: boolean; onChange: (values: DesignFormValues) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isSpecial = values.request_type === 'special';
  const isPoster = values.request_type === 'poster';
  return <SystemModal title="添加新申请" ariaLabel="美工申请" onClose={onClose} footer={<><button className="secondary-button compact-button" type="button" onClick={onClose}>取消</button><button className="primary-button compact-button" type="submit" form="design-form" disabled={saving}>提交</button></>}><form id="design-form" onSubmit={onSubmit}><div className="form-grid"><SelectField label="申请类型" value={values.request_type} onChange={(value) => onChange({ ...values, request_type: value as DesignRequestType })}>{designTypes.map((type) => <option key={type} value={type}>{designTypeLabels[type]}</option>)}</SelectField>{!isSpecial ? <><SelectField label="平台" value={values.platform} onChange={(value) => onChange({ ...values, platform: value as CreatorPlatform })}><option value="tiktok">TikTok</option><option value="douyin">抖音</option></SelectField><TextField label={values.platform === 'tiktok' ? 'TikTok ID' : '抖音 UID'} value={values.platform_user_id} onChange={(value) => onChange({ ...values, platform_user_id: value })} /><TextField label={values.platform === 'tiktok' ? 'TikTok 名字' : '抖音名字'} value={values.creator_name} onChange={(value) => onChange({ ...values, creator_name: value })} /><TextField label={values.platform === 'tiktok' ? 'TikTok 用户名' : '抖音号'} value={values.platform_account} onChange={(value) => onChange({ ...values, platform_account: value })} /></> : null}{!isSpecial && !isPoster ? <><TextField label="粉丝昵称" value={values.fan_nickname} onChange={(value) => onChange({ ...values, fan_nickname: value })} /><TextField label="粉丝灯牌等级 / 财富等级" value={values.fan_level} onChange={(value) => onChange({ ...values, fan_level: value })} /><SelectField label="打印方式" value={values.print_method} onChange={(value) => onChange({ ...values, print_method: value as DesignFormValues['print_method'] })}>{Object.entries(printMethodLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField></> : null}{!isSpecial ? <TextField label={isPoster ? '海报内容' : '设计内容'} value={values.design_content} onChange={(value) => onChange({ ...values, design_content: value })} /> : null}{isPoster ? <TextField label="设计元素" value={values.design_elements} onChange={(value) => onChange({ ...values, design_elements: value })} /> : null}{isSpecial ? <label className="form-field form-field-wide"><span>自由需求说明</span><textarea value={values.special_content} onChange={(event) => onChange({ ...values, special_content: event.target.value })} /></label> : null}<label className="form-field form-field-wide"><span>参考图片链接（每行一个，未来可接文件上传）</span><textarea value={values.reference_urls} onChange={(event) => onChange({ ...values, reference_urls: event.target.value })} /></label></div></form></SystemModal>;
}

function TextField({ label, value, onChange, type = 'text', required }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return <label className="form-field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>;
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('zh-MY') : '-';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '未知错误';
}

