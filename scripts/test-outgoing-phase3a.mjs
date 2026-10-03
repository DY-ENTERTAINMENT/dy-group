import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202610020002_outgoing_requests_phase3a.sql', import.meta.url), 'utf8');
const executableSql = migration.replace(/^--.*$/gm, '');

for (const table of ['outgoing_requests', 'outgoing_request_review_history']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
}

for (const permission of ['outgoing-application', 'outgoing-approval', 'outgoing-management', 'outgoing-exception-handling', 'outgoing-photos', 'outgoing-settings']) {
  assert.match(migration, new RegExp(`'${permission}'`));
}

for (const fn of ['create_outgoing_request', 'cancel_outgoing_request', 'review_outgoing_request', 'get_my_outgoing_approval_pending_count']) {
  assert.match(migration, new RegExp(`function public\\.${fn}`));
}

assert.match(migration, /status <> 'pending'/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /count\(distinct r\.id\)/);
assert.match(migration, /p_outgoing_date < \(now\(\) at time zone 'Asia\/Kuala_Lumpur'\)::date/);
assert.doesNotMatch(migration, /p_outgoing_date <> \(now\(\) at time zone 'Asia\/Kuala_Lumpur'\)::date/);
assert.match(migration, /revoke all on function public\.outgoing_current_actor_name\(\) from public, anon, authenticated/);
assert.match(migration, /current_user_has_permission\('outgoing-approval', 'use'\)/);
assert.match(migration, /current_user_can_access_region\(request_row\.region_id\)/);
assert.match(migration, /request_row\.profile_id = auth\.uid\(\)/);
assert.doesNotMatch(executableSql, /outgoing_region_approver/);
assert.doesNotMatch(executableSql, /outgoing_request_approvers/);
assert.doesNotMatch(executableSql, /set_outgoing_region_approvers/);
assert.doesNotMatch(executableSql, /reassign_outgoing_request_approvers/);
assert.doesNotMatch(executableSql, /create_attendance_record_checked/);
assert.doesNotMatch(executableSql, /attendance_records/);
assert.doesNotMatch(executableSql, /storage\.objects/);
assert.doesNotMatch(executableSql, /outgoing_events/);

console.log('outgoing Phase 3A migration boundary checks passed');
