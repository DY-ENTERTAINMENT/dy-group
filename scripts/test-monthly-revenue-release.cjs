const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require('typescript');
const reports = [];
let db = { rpc: async () => { throw Error('Unexpected RPC'); } };
function load(file, overrides = {}, extra = '') {
  const source = fs.readFileSync(path.join(root,file),'utf8') + extra;
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module = { exports: {} };
  const jsx = (type,props,key) => ({type,props:props ?? {},key});
  const fallback = {
    '../lib/supabase': {supabase:db},
    'react/jsx-runtime': {jsx,jsxs:jsx,Fragment:'fragment'},
    '../services/scout.service': {platformLabels:{tiktok:'TikTok',douyin:'抖音'},creatorTypeLabels:{'5+1':'5+1'},getEmployeeName:e=>e?.full_name ?? ''},
    '../services/agent.service': {platformLabels:{tiktok:'TikTok',douyin:'抖音'},creatorTypeLabels:{'5+1':'5+1'},getEmployeeName:e=>e?.full_name ?? ''},
  };
  vm.runInNewContext(code,{module,exports:module.exports,require(name){
    if (name in overrides) return overrides[name];
    if (name in fallback) return fallback[name];
    if(name.endsWith('revenue-cycle-display'))return display;
    if(name.endsWith('revenue-cycle.service'))return cycle;
    return {};
  },console,Date,Intl,Map,Set,Number,String,Math,Object,Array,Promise,Error},{filename:file});
  return module.exports;
}
const display=load('src/services/revenue-cycle-display.ts');
let cycle;
const context=(source='LEGACY_UNKNOWN',effective=null,can_write=true)=>({creator_profile_id:'monthly',cycle_source:source,effective_cycle:effective,can_write,monthly_record:null});
const creator=(id,platform='tiktok',current='monthly',ctx=context())=>({id,creator_entity_id:'entity-'+id,creator_name:id,platform,platform_user_id:id,platform_account:id,region_id:'MY',membership_status:'active',status:'active',creator_type:'5+1',joined_date:'2026-01-01',created_at:'2026-01-01',manager_employee_id:'owner',current_revenue_cycle:current,revenue_cycle:display.rosterCycle(current,ctx),revenueMonthContext:{...ctx,creator_profile_id:id}});
const baseFilters={platform:'',revenueCycle:'',managerEmployeeId:'',creatorType:'',priority:'',search:'',status:''};
const periods=Array.from({length:5},(_,i)=>({startIso:'2026-10-'+String(1+i*6).padStart(2,'0'),endIso:'2026-10-'+String(6+i*6).padStart(2,'0'),label:'period',shortLabel:'period',periodNo:i+1}));
const agent=load('src/pages/AgentPage.tsx',{},'\nexport { buildOperationStreamerRows, filterOperationStreamerRows, summarizeEffectiveRevenueRows, splitEffectiveCycleRows, OperationTableRow };');
function test(name,fn){return Promise.resolve().then(fn).then(()=>{reports.push({name,status:'PASS'});console.log('PASS '+name);});}
function walk(node,predicate){if(!node)return [];if(Array.isArray(node))return node.flatMap(n=>walk(n,predicate));if(typeof node!=='object')return [];return [...(predicate(node)?[node]:[]),...walk(node.props?.children,predicate),...walk(node.props?.footer,predicate)];}
function hooks(){
  const states=[],effects=[],refs=[];let cursor=0,refCursor=0,effectCursor=0;
  const deps=[];
  return {react:{useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef(initial){const i=refCursor++;return refs[i]??(refs[i]={current:initial});},useEffect(fn,dependencies){const i=effectCursor++;if(!deps[i]||dependencies.some((v,j)=>v!==deps[i][j])){deps[i]=dependencies;effects.push(fn);}}},render(fn,props){cursor=refCursor=effectCursor=0;return fn(props);},async flush(){for(const effect of effects.splice(0))effect();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));}};
}
(async()=>{
await test('MYT current month and evidence confirmation guards',()=>{
  assert.equal(display.malaysiaMonth(new Date('2026-09-30T16:01:00Z')),'2026-10');
  assert.equal(display.malaysiaMonth(new Date('2026-09-30T15:59:00Z')),'2026-09');
  const now=new Date('2026-10-14T03:00:00Z');
  assert.throws(()=>display.baselineInput('id','2026-09','真实资料依据'.repeat(8),true,now));
  assert.throws(()=>display.baselineInput('id','2026-10','短',true,now));
  assert.throws(()=>display.baselineInput('id','2026-10','真实资料依据'.repeat(8),false,now));
  assert.equal(display.baselineInput('id','2026-10','真实资料依据'.repeat(8),true,now).p_cycle,'monthly');
});
await test('Agent monthly All/Monthly visibility, unknown read-only, historical record retained',()=>{
  const c=creator('monthly');const original=JSON.stringify(c.revenueMonthContext);
  const history={id:'history',revenue_amount:80,created_at:'2026-10-01'};
  const all=agent.buildOperationStreamerRows([c],periods,{[periods[0].startIso]:{monthly:history}},baseFilters,'2026-10-31');
  const monthly=agent.buildOperationStreamerRows([c],periods,{}, {...baseFilters,revenueCycle:'monthly'},'2026-10-31');
  assert.equal(all.length,1);assert.equal(monthly.length,1);assert.equal(all[0].status,'unverified');
  assert.equal(all[0].periods[0].profiles[0].record.id,'history');
  assert.equal(agent.filterOperationStreamerRows(all,{status:'missing'}).length,0);
  assert.equal(agent.filterOperationStreamerRows(all,{status:'filled'}).length,0);
  const summary=agent.summarizeEffectiveRevenueRows(all);assert.equal(summary.missing,0);assert.equal(summary.filled,0);assert.equal(summary.tiktokTotal,0);
  assert.equal(display.canWriteMonthly(c.revenueMonthContext),false);assert.equal(JSON.stringify(c.revenueMonthContext),original);
});
await test('Verified monthly single cell and permission gate, units remain separate',()=>{
  const t=creator('tiktok','tiktok','monthly',context('VERIFIED','monthly'));
  const d=creator('douyin','douyin','monthly',context('VERIFIED','monthly'));
  t.revenueMonthContext.monthly_record={revenue_amount:120};d.revenueMonthContext.monthly_record={revenue_amount:300};
  const rows=agent.buildOperationStreamerRows([t,d],periods,{},baseFilters,'2026-10-31');
  const summary=agent.summarizeEffectiveRevenueRows(rows);assert.equal(summary.tiktokTotal,120);assert.equal(summary.douyinTotal,300);assert.equal(summary.filled,2);
  assert.equal(display.canWriteMonthly(t.revenueMonthContext),true);
  assert.equal(display.canWriteMonthly({...t.revenueMonthContext,can_write:false}),false);
  const render=agent.OperationTableRow({row:rows[0],selectedPeriodStart:periods[0].startIso,onOpen(){},month:'2026-10',onMonthlySaved(){}});
  assert.equal(walk(render,n=>n.type==='td'&&n.props.colSpan===5).length,1);
  assert.equal(walk(render,n=>typeof n.type==='function'&&n.type.name==='PeriodRevenueCell').length,0);
});
await test('Legacy weekly five cells and none do not regress; manager filter isolates',()=>{
  const w=creator('weekly','tiktok','weekly',context('LEGACY_CURRENT_WEEKLY','weekly'));
  const n=creator('none','douyin','none',context('VERIFIED','none'));
  const rows=agent.buildOperationStreamerRows([w,n],periods,{},baseFilters,'2026-10-31');
  const summary=agent.summarizeEffectiveRevenueRows(rows);assert.equal(summary.missing,5);
  const render=agent.OperationTableRow({row:rows.find(r=>r.profiles[0].id==='weekly'),selectedPeriodStart:periods[0].startIso,onOpen(){},month:'2026-10',onMonthlySaved(){}});
  assert.equal(walk(render,n=>typeof n.type==='function'&&n.type.name==='PeriodRevenueCell').length,5);
  assert.equal(agent.buildOperationStreamerRows([w,n],periods,{}, {...baseFilters,managerEmployeeId:'foreign'},'2026-10-31').length,0);
  assert.equal(display.rosterCycle('monthly',context('VERIFIED','weekly')),'weekly');
  assert.equal(display.rosterCycle('none',context()),undefined);
});
await test('Management monthly intersection, no foreign rows, region/manager preserved, unknown remains unknown',async()=>{
  const calls=[];const raw=[{creator_profile_id:'legacy',cycle_source:'LEGACY_UNKNOWN',creator_revenue_cycle:null,reporting_manager_employee_id:'owner',record_kind:'weekly',has_revenue_record:false},{creator_profile_id:'verified',cycle_source:'VERIFIED',creator_revenue_cycle:'monthly'},{creator_profile_id:'weekly',cycle_source:'LEGACY_CURRENT_WEEKLY',creator_revenue_cycle:'weekly'},{creator_profile_id:'none',cycle_source:'VERIFIED',creator_revenue_cycle:'none'}];
  const client={rpc:async(name,input)=>{calls.push({name,input});return {error:null,data:name==='list_management_revenue_records_e'?raw.map(record=>({record})):[{creator_profile_id:'legacy'},{creator_profile_id:'foreign'}]};}};
  const {readManagementRevenueRoster}=load('src/services/management-revenue-roster.ts');
  const rows=await readManagementRevenueRoster(client,{startDate:'2026-10-01',endDate:'2026-10-31',managerEmployeeId:'owner',regionId:'MY',revenueCycle:'monthly'});
  assert.deepEqual(Array.from(rows,r=>r.creator_profile_id),['legacy','verified']);
  assert.equal(rows[0].effective_revenue_cycle,null);assert.equal(rows[0].cycle_source,'LEGACY_UNKNOWN');assert.equal(rows[0].has_revenue_record,false);
  assert.equal(calls[0].input.p_manager_employee_id,'owner');assert.equal(calls[0].input.p_region_id,'MY');assert.equal(calls[1].input.p_region_id,'MY');assert.equal(calls[0].input.p_revenue_cycle,null);
  const empty=await readManagementRevenueRoster({rpc:async()=>({data:[],error:null})},{startDate:'2026-10-01',endDate:'2026-10-31',regionId:'foreign',revenueCycle:'monthly'});assert.equal(empty.length,0);
  await assert.rejects(()=>readManagementRevenueRoster({rpc:async()=>({data:null,error:Error('42501')})},{startDate:'2026-10-01',endDate:'2026-10-31'}));
});
await test('Management pagination covers 501 old monthly and settings cannot add rows',async()=>{
  const raw=Array.from({length:501},(_,i)=>({creator_profile_id:'id'+i,cycle_source:'LEGACY_UNKNOWN',creator_revenue_cycle:null}));
  const calls=[];
  const client={rpc:async(name,input)=>{calls.push([name,input.p_offset]);const values=name==='list_management_revenue_records_e'?raw.map(record=>({record})):[...raw.map(row=>({creator_profile_id:row.creator_profile_id})),{creator_profile_id:'foreign'}];return {data:values.slice(input.p_offset,input.p_offset+500),error:null};}};
  const {readManagementRevenueRoster}=load('src/services/management-revenue-roster.ts');
  const rows=await readManagementRevenueRoster(client,{startDate:'2026-10-01',endDate:'2026-10-31',revenueCycle:'monthly'});
  assert.equal(rows.length,501);assert.equal(calls.length,4);assert.ok(!rows.some(r=>r.creator_profile_id==='foreign'));
});
await test('Baseline form invokes existing RPC once then refreshes current monthly context',async()=>{
  const calls=[];let initialized=false;let refreshed=0;
  db={rpc:async(name,input)=>{calls.push({name,input});if(name==='initialize_creator_revenue_cycle_baseline'){initialized=true;return {data:null,error:null};}if(name==='list_creator_revenue_month_context')return {data:[initialized?context('VERIFIED','monthly'):context()],error:null};throw Error(name);}};
  cycle=load('src/services/revenue-cycle.service.ts');
  const h=hooks();const baseline=load('src/components/MonthlyRevenueBaseline.tsx',{'react':h.react,'../hooks/useAuth':{useAuth:()=>({profile:{id:'admin'}})},'../services/permission-runtime.service':{permissionRuntimeService:{hasExplicitPermission:async()=>true}}});
  const props={profileId:'monthly',creatorName:'主播',month:display.malaysiaMonth(),onVerified:()=>refreshed++};
  let node=h.render(baseline.MonthlyRevenueBaseline,props);await h.flush();node=h.render(baseline.MonthlyRevenueBaseline,props);
  walk(node,n=>n.type==='button')[0].props.onClick();node=h.render(baseline.MonthlyRevenueBaseline,props);
  walk(node,n=>n.type==='textarea')[0].props.onChange({target:{value:'已核对真实资料及经纪人确认结果，本月继续采用月流水。'}});
  walk(node,n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
  node=h.render(baseline.MonthlyRevenueBaseline,props);await walk(node,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
  node=h.render(baseline.MonthlyRevenueBaseline,props);assert.equal(node,null);assert.equal(refreshed,1);
  const mutations=calls.filter(c=>c.name==='initialize_creator_revenue_cycle_baseline');assert.equal(mutations.length,1);assert.equal(mutations[0].input.p_effective_month,props.month+'-01');assert.equal(mutations[0].input.p_cycle,'monthly');
  assert.equal(calls.filter(c=>c.name==='list_creator_revenue_month_context').length,2);
});
await test('No baseline entry for View-only, already verified, inaccessible or historical month',async()=>{
  for(const scenario of [{permission:false,ctx:context(),month:display.malaysiaMonth()},{permission:true,ctx:context('VERIFIED','monthly'),month:display.malaysiaMonth()},{permission:true,ctx:null,month:display.malaysiaMonth()},{permission:true,ctx:context(),month:'2026-09'}]){
    const h=hooks();let writes=0;
    const baseline=load('src/components/MonthlyRevenueBaseline.tsx',{'react':h.react,'../hooks/useAuth':{useAuth:()=>({profile:{id:'user'}})},'../services/permission-runtime.service':{permissionRuntimeService:{hasExplicitPermission:async()=>scenario.permission}},'../services/revenue-cycle.service':{revenueCycleService:{monthContext:async()=>scenario.ctx?[scenario.ctx]:[],initializeCurrentMonthlyBaseline:async()=>writes++}}});
    const props={profileId:'id',creatorName:'主播',month:scenario.month,onVerified(){}};
    h.render(baseline.MonthlyRevenueBaseline,props);await h.flush();assert.equal(h.render(baseline.MonthlyRevenueBaseline,props),null);assert.equal(writes,0);
  }
});
await test('Baseline duplicate, denied scope and refresh failure remain safe',async()=>{
  for (const errorCode of ['23505','42501','refresh']) {
    const h=hooks();let calls=0,reads=0,refreshes=0;
    const mocked={monthContext:async()=>{reads++;if(errorCode==='refresh'&&reads>1)throw Error('offline');return [context()];},initializeCurrentMonthlyBaseline:async()=>{calls++;await new Promise(r=>setImmediate(r));if(errorCode!=='refresh')throw {code:errorCode};}};
    const baseline=load('src/components/MonthlyRevenueBaseline.tsx',{'react':h.react,'../hooks/useAuth':{useAuth:()=>({profile:{id:'admin'}})},'../services/permission-runtime.service':{permissionRuntimeService:{hasExplicitPermission:async()=>true}},'../services/revenue-cycle.service':{revenueCycleService:mocked}});
    const props={profileId:'id',creatorName:'主播',month:display.malaysiaMonth(),onVerified:()=>refreshes++};
    h.render(baseline.MonthlyRevenueBaseline,props);await h.flush();let node=h.render(baseline.MonthlyRevenueBaseline,props);
    walk(node,n=>n.type==='button')[0].props.onClick();node=h.render(baseline.MonthlyRevenueBaseline,props);
    walk(node,n=>n.type==='textarea')[0].props.onChange({target:{value:'已核对真实资料及经纪人确认结果，本月继续采用月流水。'}});
    walk(node,n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
    node=h.render(baseline.MonthlyRevenueBaseline,props);const submit=walk(node,n=>n.type==='form')[0].props.onSubmit;
    await Promise.all([submit({preventDefault(){}}),submit({preventDefault(){}})]);
    assert.equal(calls,1);node=h.render(baseline.MonthlyRevenueBaseline,props);
    assert.equal(refreshes,errorCode==='42501'?0:1);
    assert.ok(walk(node,n=>n.type==='p'&&n.props.className==='form-alert').length);
    if(errorCode!=='42501')assert.equal(walk(node,n=>n.type==='button')[0].props.disabled,true);
  }
});
await test('Weekly/none management filters stay on existing server path',async()=>{
  const {readManagementRevenueRoster}=load('src/services/management-revenue-roster.ts');
  for(const cycle of ['weekly','none']) {
    let calls=0;
    const rows=await readManagementRevenueRoster({rpc:async(name,input)=>{calls++;assert.equal(name,'list_management_revenue_records_e');assert.equal(input.p_revenue_cycle,cycle);return {data:[{record:{creator_profile_id:cycle,creator_revenue_cycle:cycle,cycle_source:'VERIFIED'}}],error:null};}},{startDate:'2026-10-01',endDate:'2026-10-31',revenueCycle:cycle});
    assert.equal(rows.length,1);assert.equal(calls,1);
  }
});
console.log('Focused tests complete: '+reports.length);
})().catch(error=>{console.error(error);process.exitCode=1;});
