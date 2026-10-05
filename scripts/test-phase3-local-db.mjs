import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const apiUrl = required('API_URL');
const anonKey = required('ANON_KEY');
const serviceRoleKey = required('SERVICE_ROLE_KEY');
assert.match(apiUrl, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, 'tests must target only a local Supabase API');

const admin = createClient(apiUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const fixturePhoto = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const today = malaysiaDate();

const regions = await getRegions();
const accounts = await createFixtureAccounts(regions);
const { employee, regionalHr, crossRegionHr, superAdmin, inactiveEmployee } = await signInAll(accounts);

await assertFixturePreflight({ employee, regionalHr, crossRegionHr, superAdmin, inactiveEmployee }, accounts, regions);
await assertOutgoingFeatureGate(employee, regionalHr, superAdmin, accounts);
await assertAttendanceRegression(employee, accounts.employee, regions.primary);
await assertRequestApprovalAndRls(employee, regionalHr, crossRegionHr, superAdmin, accounts, regions.primary);
await assertOutgoingLifecycleAndReconciliation(employee, regionalHr, crossRegionHr, accounts, regions.primary);
await assertAttendanceRegressionAfterOutgoing(employee, crossRegionHr, superAdmin, accounts.employee);
await expectError(() => inactiveEmployee.rpc('create_outgoing_request', requestInput('16:00', '16:30', 'inactive account')), /permission|active|employee/i);

console.log('Phase 3 isolated local database integration tests passed');

async function getRegions() {
  const { data, error } = await admin.from('regions').select('id, code').order('code');
  assert.ifError(error);
  assert.ok(data.length >= 2, 'fixture requires at least two regions from the base migrations');
  return { primary: data[0], secondary: data[1] };
}

async function createFixtureAccounts(regions) {
  // Auth user creation creates the pending profile through the production
  // trigger. The disposable database fixture replaces those pending rows
  // before any business RPC is exercised; it never disables RLS or fabricates
  // a JWT authentication claim.
  const accounts = {
    employee: await createAuthAccount('employee'),
    regionalHr: await createAuthAccount('regional-hr'),
    crossRegionHr: await createAuthAccount('cross-region-hr'),
    superAdmin: await createAuthAccount('super-admin'),
    inactiveEmployee: await createAuthAccount('inactive'),
  };
  await provisionLocalFixtureAccounts(accounts, regions);
  return accounts;
}

async function createAuthAccount(label) {
  const email = `phase3-${label}-${crypto.randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Phase3-local-only-123!', email_confirm: true, user_metadata: { full_name: `Phase 3 ${label}` } });
  assert.ifError(error);
  return { label, email, profileId: data.user.id, employeeId: crypto.randomUUID() };
}

async function provisionLocalFixtureAccounts(accounts, regions) {
  const definitions = [
    [accounts.employee, 'staff', 'active', regions.primary.id, ['outgoing-application']],
    [accounts.regionalHr, 'hr', 'active', regions.primary.id, ['outgoing-approval', 'outgoing-management', 'outgoing-exception-handling', 'outgoing-photos']],
    [accounts.crossRegionHr, 'hr', 'active', regions.secondary.id, ['outgoing-approval', 'outgoing-management']],
    [accounts.superAdmin, 'super_admin', 'active', regions.secondary.id, []],
    [accounts.inactiveEmployee, 'staff', 'inactive', regions.primary.id, ['outgoing-application']],
  ];
  const statements = [
    'begin;',
    `delete from public.profiles where id in (${definitions.map(([account]) => `${sqlLiteral(account.profileId)}::uuid`).join(', ')});`,
  ];
  for (const [account, role, employeeStatus, regionId, permissions] of definitions) {
    const name = `Phase 3 ${account.label}`;
    statements.push(
      `insert into public.profiles (id, email, full_name, role, status, region_id) values (${sqlLiteral(account.profileId)}::uuid, ${sqlLiteral(account.email)}, ${sqlLiteral(name)}, ${sqlLiteral(role)}::public.app_role, 'approved'::public.profile_status, ${sqlLiteral(regionId)}::uuid);`,
      `insert into public.employees (id, profile_id, employee_code, full_name, email, region_id, status, require_attendance) values (${sqlLiteral(account.employeeId)}::uuid, ${sqlLiteral(account.profileId)}::uuid, ${sqlLiteral(`P3-${account.label}-${account.employeeId.slice(0, 8)}`)}, ${sqlLiteral(name)}, ${sqlLiteral(account.email)}, ${sqlLiteral(regionId)}::uuid, ${sqlLiteral(employeeStatus)}::public.employee_status, ${employeeStatus === 'active'}) on conflict (id) do nothing;`,
    );
    for (const permission of permissions) {
      statements.push(`insert into public.employee_permission_overrides (employee_id, permission_key, can_view, can_use, effect) values (${sqlLiteral(account.employeeId)}::uuid, ${sqlLiteral(permission)}, true, true, 'grant') on conflict (employee_id, permission_key) do update set can_view = excluded.can_view, can_use = excluded.can_use, effect = excluded.effect;`);
    }
  }
  statements.push('commit;');
  const dbContainer = findLocalSupabaseDatabaseContainer();
  execFileSync('docker', ['exec', '-i', dbContainer, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c', statements.join('\n')], { stdio: 'pipe' });
}

function findLocalSupabaseDatabaseContainer() {
  const rows = execFileSync('docker', ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Labels}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const matches = rows.map((row) => row.split('\t')).filter(([, name, labels]) => name.startsWith('supabase_db_') && labels.includes('com.supabase.cli.project=dy-group-phase3-ci'));
  assert.equal(matches.length, 1, `Expected exactly one isolated Supabase database container; found ${matches.length}`);
  return matches[0][0];
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function signIn(email) {
  const client = createClient(apiUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'Phase3-local-only-123!' });
  assert.ifError(error);
  assert.ok(data.session?.access_token, `missing local session for ${email}`);
  return client;
}

async function signInAll(accounts) {
  const entries = Object.entries(accounts);
  const settled = await Promise.allSettled(entries.map(async ([label, account]) => [label, await signIn(account.email)]));
  const failures = settled.filter((result) => result.status === 'rejected');
  assert.equal(failures.length, 0, `Fixture authentication failed: ${failures.map((result) => String(result.reason?.message ?? result.reason)).join('; ')}`);
  return Object.fromEntries(settled.map((result) => result.value));
}

async function assertFixturePreflight(clients, accounts, regions) {
  const { data: rows, error } = await admin.from('employees').select('id, profile_id, region_id, status').in('profile_id', Object.values(accounts).map((account) => account.profileId));
  assert.ifError(error);
  assert.equal(rows.length, 5, 'all authenticated fixture accounts must have exactly one employee row before business tests');
  for (const account of Object.values(accounts)) {
    const row = rows.find((candidate) => candidate.profile_id === account.profileId);
    assert.ok(row, `missing employee fixture for ${account.label}`);
    assert.equal(row.id, account.employeeId, `unexpected employee fixture identity for ${account.label}`);
  }
  assert.equal(rows.find((row) => row.profile_id === accounts.employee.profileId)?.region_id, regions.primary.id);
  assert.equal(rows.find((row) => row.profile_id === accounts.crossRegionHr.profileId)?.region_id, regions.secondary.id);

  const activeChecks = await Promise.allSettled([
    clients.employee.rpc('current_user_is_active_employee'),
    clients.regionalHr.rpc('current_user_is_active_employee'),
    clients.crossRegionHr.rpc('current_user_is_active_employee'),
    clients.superAdmin.rpc('current_user_is_active_employee'),
    clients.inactiveEmployee.rpc('current_user_is_active_employee'),
  ]);
  assert.equal(activeChecks.filter((result) => result.status === 'rejected' || result.value.error).length, 0, 'fixture active-account checks must be callable by real sessions');
  assert.deepEqual(activeChecks.map((result) => result.value.data), [true, true, true, true, false], 'fixture statuses must be visible to the production account guard');
  assert.equal(await rpc(clients.employee, 'current_user_has_permission', { p_permission_key: 'outgoing-application', p_action: 'use' }), true);
  assert.equal(await rpc(clients.regionalHr, 'current_user_has_permission', { p_permission_key: 'outgoing-approval', p_action: 'use' }), true);
  assert.equal(await rpc(clients.crossRegionHr, 'current_user_can_access_region', { region_id: regions.primary.id }), false, 'cross-region fixture must not gain primary-region access');
}

async function assertOutgoingFeatureGate(employee, regionalHr, superAdmin, accounts) {
  assert.equal(await rpc(employee, 'get_outgoing_feature_admissions_enabled', {}), false, 'Phase 3C must default closed');
  await expectError(() => employee.rpc('create_outgoing_request', requestInput('08:00', '08:30', 'closed gate')), /disabled/i);
  await expectError(() => regionalHr.rpc('set_outgoing_feature_admissions_enabled', { p_enabled: true }), /permission/i);
  const { error: grantSettingsError } = await admin.from('employee_permission_overrides').upsert({ employee_id: accounts.regionalHr.employeeId, permission_key: 'outgoing-settings', can_view: true, can_use: true, effect: 'grant' }, { onConflict: 'employee_id,permission_key' });
  assert.ifError(grantSettingsError);
  await rpc(regionalHr, 'set_outgoing_feature_admissions_enabled', { p_enabled: true });
  assert.equal(await rpc(employee, 'get_outgoing_feature_admissions_enabled', {}), true);
  const { data: audit, error } = await admin.from('outgoing_feature_control_audit').select('previous_enabled, next_enabled, changed_by').eq('next_enabled', true);
  assert.ifError(error);
  assert.ok(audit.some((row) => row.previous_enabled === false && row.changed_by === accounts.regionalHr.profileId), 'explicit outgoing-settings enable action must be audited');

  const { count: disableAuditBefore, error: disableCountError } = await admin.from('outgoing_feature_control_audit').select('id', { count: 'exact', head: true }).eq('previous_enabled', true).eq('next_enabled', false);
  assert.ifError(disableCountError);
  await rpc(superAdmin, 'set_outgoing_feature_admissions_enabled', { p_enabled: false });
  const { data: disableAudit, error: disableAuditError } = await admin.from('outgoing_feature_control_audit').select('previous_enabled, next_enabled, changed_by, changed_at').eq('previous_enabled', true).eq('next_enabled', false).order('changed_at', { ascending: false });
  assert.ifError(disableAuditError);
  assert.equal(disableAudit.length, (disableAuditBefore ?? 0) + 1, 'a state change must create exactly one disable audit row');
  const latestDisable = disableAudit[0];
  assert.equal(latestDisable.changed_by, accounts.superAdmin.profileId, 'disable audit actor must be the super admin');
  assert.ok(Number.isFinite(new Date(latestDisable.changed_at).getTime()), 'disable audit must include a valid timestamp');
  await rpc(superAdmin, 'set_outgoing_feature_admissions_enabled', { p_enabled: false });
  const { count: disableAuditAfterNoop, error: disableNoopCountError } = await admin.from('outgoing_feature_control_audit').select('id', { count: 'exact', head: true }).eq('previous_enabled', true).eq('next_enabled', false);
  assert.ifError(disableNoopCountError);
  assert.equal(disableAuditAfterNoop, disableAudit.length, 'repeating an unchanged disable must not create an audit row');
  await rpc(superAdmin, 'set_outgoing_feature_admissions_enabled', { p_enabled: true });
}

async function assertAttendanceRegression(client, account, region) {
  const location = await createLocation(region.id);
  await upload(client, 'attendance-photos', `${account.profileId}/clock-in.jpg`);
  const { error } = await client.rpc('create_attendance_record_checked', {
    p_punch_type: 'clock_in', p_photo_path: `${account.profileId}/clock-in.jpg`, p_latitude: 3.139, p_longitude: 101.6869,
    p_accuracy: 5, p_ip_address: '127.0.0.1', p_device_info: 'Phase 3 isolated CI',
  });
  assert.ifError(error);
  for (const punchType of ['break_start', 'break_end']) {
    const path = `${account.profileId}/${punchType}.jpg`;
    await upload(client, 'attendance-photos', path);
    await rpc(client, 'create_attendance_record_checked', { p_punch_type: punchType, p_photo_path: path, p_latitude: 3.139, p_longitude: 101.6869, p_accuracy: 5, p_ip_address: '127.0.0.1', p_device_info: 'Phase 3 isolated CI' });
  }
  const { data: records, error: readError } = await client.from('attendance_records').select('punch_type').eq('profile_id', account.profileId);
  assert.ifError(readError);
  assert.deepEqual(new Set(records.map((record) => record.punch_type)), new Set(['clock_in', 'break_start', 'break_end']), 'existing clock-in and break paths must remain available');
  return location;
}

async function assertAttendanceRegressionAfterOutgoing(employee, crossRegionHr, superAdmin, account) {
  const { data: ownRows, error: ownError } = await employee.from('attendance_records').select('punch_type').eq('profile_id', account.profileId);
  assert.ifError(ownError);
  assert.deepEqual(new Set(ownRows.map((row) => row.punch_type)), new Set(['clock_in', 'break_start', 'break_end', 'clock_out']), 'existing employee attendance timeline must remain readable after outgoing reconciliation');
  const { data: superRows, error: superError } = await superAdmin.from('attendance_records').select('punch_type').eq('profile_id', account.profileId);
  assert.ifError(superError);
  assert.equal(superRows.length, 4, 'super-admin attendance access must remain available after Phase 3 migrations');
  const { data: crossRows, error: crossError } = await crossRegionHr.from('attendance_records').select('id').eq('profile_id', account.profileId);
  assert.ifError(crossError);
  assert.equal(crossRows.length, 0, 'unrelated HR must not gain attendance-record access');
  const { error: ownPhotoError } = await employee.storage.from('attendance-photos').download(`${account.profileId}/clock-out.jpg`);
  assert.equal(ownPhotoError, null, 'employee must retain access to their original attendance photo');
  const { error: unrelatedPhotoError } = await crossRegionHr.storage.from('attendance-photos').download(`${account.profileId}/clock-out.jpg`);
  assert.ok(unrelatedPhotoError, 'unrelated HR must not gain attendance-photo access');
}

async function createLocation(regionId) {
  const { data, error } = await admin.from('attendance_locations').insert({ region_id: regionId, name: `Phase 3 CI ${crypto.randomUUID()}`, latitude: 3.139, longitude: 101.6869, radius_meters: 500 }).select('id').single();
  assert.ifError(error);
  return data;
}

async function assertRequestApprovalAndRls(employee, regionalHr, crossRegionHr, superAdmin, accounts) {
  const requestId = await createRequest(employee, '09:00', '09:30', 'approval and RLS');
  await expectError(() => crossRegionHr.rpc('review_outgoing_request', { p_request_id: requestId, p_decision: 'approved', p_note: null }), /permission/i);
  const { error: selfApprovalGrantError } = await admin.from('employee_permission_overrides').upsert({ employee_id: accounts.employee.employeeId, permission_key: 'outgoing-approval', can_view: true, can_use: true, effect: 'grant' }, { onConflict: 'employee_id,permission_key' });
  assert.ifError(selfApprovalGrantError);
  await expectError(() => employee.rpc('review_outgoing_request', { p_request_id: requestId, p_decision: 'approved', p_note: null }), /own outgoing request/i);
  await rpc(regionalHr, 'review_outgoing_request', { p_request_id: requestId, p_decision: 'approved', p_note: null });
  await expectError(() => regionalHr.rpc('review_outgoing_request', { p_request_id: requestId, p_decision: 'approved', p_note: null }), /final|already/i);
  const { data: own, error: ownError } = await employee.from('outgoing_requests').select('id').eq('id', requestId);
  assert.ifError(ownError); assert.equal(own.length, 1);
  const { data: denied, error: deniedError } = await crossRegionHr.from('outgoing_requests').select('id').eq('id', requestId);
  assert.ifError(deniedError); assert.equal(denied.length, 0, 'cross-region HR must not read this request');
  const { data: all, error: superError } = await superAdmin.from('outgoing_requests').select('id').eq('id', requestId);
  assert.ifError(superError); assert.equal(all.length, 1, 'super admin must retain global access');
  const cancellationId = await createRequest(employee, '09:30', '10:00', 'cancellation');
  await rpc(employee, 'cancel_outgoing_request', { p_request_id: cancellationId });
  await expectError(() => employee.rpc('cancel_outgoing_request', { p_request_id: cancellationId }), /only|not found/i);
  const rejectedId = await createRequest(employee, '10:00', '10:30', 'rejection');
  await rpc(regionalHr, 'review_outgoing_request', { p_request_id: rejectedId, p_decision: 'rejected', p_note: 'fixture rejection' });
  await expectError(() => regionalHr.rpc('review_outgoing_request', { p_request_id: rejectedId, p_decision: 'rejected', p_note: 'duplicate' }), /final|already/i);
}

async function assertOutgoingLifecycleAndReconciliation(employee, regionalHr, crossRegionHr, accounts) {
  const gateStartId = await approvedRequest(employee, regionalHr, '10:30', '10:45', 'closed start');
  const gateStartPath = `${accounts.employee.profileId}/${gateStartId}/start.jpg`;
  await upload(employee, 'outgoing-photos', gateStartPath);
  await rpc((await signIn(accounts.superAdmin.email)), 'set_outgoing_feature_admissions_enabled', { p_enabled: false });
  await expectError(() => employee.rpc('start_outgoing_event', startArgs(gateStartId, gateStartPath, 3.139, 101.6869)), /disabled/i);
  await expectError(() => employee.storage.from('outgoing-photos').upload(`${accounts.employee.profileId}/${gateStartId}/blocked.jpg`, fixturePhoto, { contentType: 'image/jpeg', upsert: false }), /disabled|policy|row-level/i);
  await rpc((await signIn(accounts.superAdmin.email)), 'set_outgoing_feature_admissions_enabled', { p_enabled: true });
  const requestId = await approvedRequest(employee, regionalHr, '11:00', '11:30', 'lifecycle');
  const basePath = `${accounts.employee.profileId}/${requestId}`;
  await upload(employee, 'outgoing-photos', `${basePath}/far.jpg`);
  await expectError(() => employee.rpc('start_outgoing_event', startArgs(requestId, `${basePath}/far.jpg`, 0, 0)), /outside|location/i);
  await upload(employee, 'outgoing-photos', `${basePath}/start.jpg`);
  const key = crypto.randomUUID();
  const eventId = await rpc(employee, 'start_outgoing_event', { ...startArgs(requestId, `${basePath}/start.jpg`, 3.139, 101.6869), p_idempotency_key: key });
  assert.equal(await rpc(employee, 'start_outgoing_event', { ...startArgs(requestId, `${basePath}/start.jpg`, 3.139, 101.6869), p_idempotency_key: key }), eventId, 'same start key must be idempotent');
  await expectError(() => employee.rpc('start_outgoing_event', { ...startArgs(requestId, `${basePath}/start.jpg`, 3.139, 101.6869), p_idempotency_key: crypto.randomUUID() }), /already/i);
  const { error: crossPhotoError } = await crossRegionHr.storage.from('outgoing-photos').download(`${basePath}/start.jpg`);
  assert.ok(crossPhotoError, 'cross-region HR must not read a private outgoing photo');
  const { error: regionalPhotoError } = await regionalHr.storage.from('outgoing-photos').download(`${basePath}/start.jpg`);
  assert.equal(regionalPhotoError, null, 'authorized regional HR must read the private outgoing photo');
  const { error: revokePhotoPermissionError } = await admin.from('employee_permission_overrides').delete().eq('employee_id', accounts.regionalHr.employeeId).eq('permission_key', 'outgoing-photos');
  assert.ifError(revokePhotoPermissionError);
  const { error: noExplicitPhotoPermissionError } = await regionalHr.storage.from('outgoing-photos').download(`${basePath}/start.jpg`);
  assert.ok(noExplicitPhotoPermissionError, 'approval and management permissions must not implicitly grant outgoing-photo access');
  const closedApprovalId = await createRequest(employee, '14:00', '14:10', 'closed approval');
  const closedCancellationId = await createRequest(employee, '14:15', '14:25', 'closed cancellation');
  const closedRejectionId = await createRequest(employee, '14:30', '14:40', 'closed rejection');
  await rpc((await signIn(accounts.superAdmin.email)), 'set_outgoing_feature_admissions_enabled', { p_enabled: false });
  await expectError(() => employee.rpc('create_outgoing_request', requestInput('14:45', '14:55', 'closed after start')), /disabled/i);
  await expectError(() => regionalHr.rpc('review_outgoing_request', { p_request_id: closedApprovalId, p_decision: 'approved', p_note: null }), /disabled/i);
  await rpc(employee, 'cancel_outgoing_request', { p_request_id: closedCancellationId });
  await rpc(regionalHr, 'review_outgoing_request', { p_request_id: closedRejectionId, p_decision: 'rejected', p_note: 'closed-gate rejection remains allowed' });
  const { data: closedHistory, error: closedHistoryError } = await employee.from('outgoing_request_review_history').select('action').eq('request_id', closedCancellationId);
  assert.ifError(closedHistoryError);
  assert.ok(closedHistory.some((row) => row.action === 'cancelled'), 'history must remain readable while admissions are closed');
  await upload(employee, 'outgoing-photos', `${basePath}/end.jpg`);
  const endKey = crypto.randomUUID();
  assert.equal(await rpc(employee, 'finish_outgoing_event', { ...startArgs(requestId, `${basePath}/end.jpg`, 3.139, 101.6869), p_idempotency_key: endKey }), eventId);
  assert.equal(await rpc(employee, 'finish_outgoing_event', { ...startArgs(requestId, `${basePath}/end.jpg`, 3.139, 101.6869), p_idempotency_key: endKey }), eventId, 'same end key must be idempotent');
  await expectError(() => employee.rpc('finish_outgoing_event', { ...startArgs(requestId, `${basePath}/end.jpg`, 3.139, 101.6869), p_idempotency_key: crypto.randomUUID() }), /cannot be finished/i);
  await rpc((await signIn(accounts.superAdmin.email)), 'set_outgoing_feature_admissions_enabled', { p_enabled: true });

  const concurrent = await Promise.all(['12:00', '12:30'].map((start, index) => approvedRequest(employee, regionalHr, start, index ? '13:00' : '12:30', `concurrent-${index}`)));
  for (const id of concurrent) await upload(employee, 'outgoing-photos', `${accounts.employee.profileId}/${id}/start.jpg`);
  const outcomes = await Promise.allSettled(concurrent.map((id) => employee.rpc('start_outgoing_event', startArgs(id, `${accounts.employee.profileId}/${id}/start.jpg`, 3.139, 101.6869))));
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled' && !outcome.value.error).length, 1, 'only one concurrent outgoing event may start');
  const activeRequestId = concurrent[outcomes.findIndex((outcome) => outcome.status === 'fulfilled' && !outcome.value.error)];
  await upload(employee, 'attendance-photos', `${accounts.employee.profileId}/clock-out.jpg`);
  await rpc(employee, 'create_attendance_record_checked', { p_punch_type: 'clock_out', p_photo_path: `${accounts.employee.profileId}/clock-out.jpg`, p_latitude: 3.139, p_longitude: 101.6869, p_accuracy: 5, p_ip_address: '127.0.0.1', p_device_info: 'Phase 3 isolated CI' });
  assert.equal(await rpc(employee, 'reconcile_outgoing_exceptions', { p_employee_id: null }), 1, 'clock-out must be reconciled independently');
  await expectError(() => employee.rpc('finish_outgoing_event', startArgs(activeRequestId, `${accounts.employee.profileId}/${activeRequestId}/start.jpg`, 3.139, 101.6869)), /cannot be finished|clock-out/i);
  const { data: exception, error: exceptionError } = await employee.from('outgoing_events').select('id, status').eq('request_id', activeRequestId).single();
  assert.ifError(exceptionError); assert.equal(exception.status, 'exception');
  await rpc((await signIn(accounts.superAdmin.email)), 'set_outgoing_feature_admissions_enabled', { p_enabled: false });
  assert.equal(await rpc(employee, 'reconcile_outgoing_exceptions', { p_employee_id: null }), 0, 'reconciliation remains callable while admissions are closed');
  await rpc(regionalHr, 'handle_outgoing_exception', { p_event_id: exception.id });
  await rpc(regionalHr, 'handle_outgoing_exception', { p_event_id: exception.id });
}

async function createRequest(client, start, end, reason) { return rpc(client, 'create_outgoing_request', requestInput(start, end, reason)); }
async function approvedRequest(employee, hr, start, end, reason) { const id = await createRequest(employee, start, end, reason); await rpc(hr, 'review_outgoing_request', { p_request_id: id, p_decision: 'approved', p_note: null }); return id; }
function requestInput(start, end, reason) { return { p_outgoing_date: today, p_planned_start_time: start, p_planned_return_time: end, p_outgoing_type: 'client_visit', p_location: 'Phase 3 local CI fixture', p_reason: reason, p_related_contact: null, p_remarks: null }; }
function startArgs(requestId, path, latitude, longitude) { return { p_request_id: requestId, p_photo_path: path, p_latitude: latitude, p_longitude: longitude, p_accuracy: 5, p_idempotency_key: crypto.randomUUID() }; }
async function upload(client, bucket, path) { const { error } = await client.storage.from(bucket).upload(path, fixturePhoto, { contentType: 'image/jpeg', upsert: false }); assert.ifError(error); }
async function rpc(client, name, args) { const { data, error } = await client.rpc(name, args); assert.ifError(error); return data; }
async function expectError(run, pattern) { try { const result = await run(); if (result?.error) throw result.error; assert.fail('Expected operation to fail'); } catch (error) { assert.match(String(error?.message ?? error), pattern); } }
function required(name) { const value = process.env[name]; assert.ok(value, `Missing ${name}`); return value; }
function malaysiaDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`; }
