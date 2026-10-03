import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202610030001_outgoing_events_phase3b.sql', import.meta.url), 'utf8');

for (const table of ['outgoing_events', 'outgoing_event_audit_history']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
}

for (const fn of ['outgoing_find_verified_location', 'outgoing_verify_photo_path', 'start_outgoing_event', 'finish_outgoing_event', 'reconcile_outgoing_exceptions', 'handle_outgoing_exception']) {
  assert.match(migration, new RegExp(`function public\\.${fn}`));
}

assert.match(migration, /request_id uuid not null unique/);
assert.match(migration, /start_idempotency_key uuid not null unique/);
assert.match(migration, /end_idempotency_key uuid unique/);
assert.match(migration, /for update/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /current_user_is_active_employee\(\)/);
assert.match(migration, /current_user_has_explicit_permission\('outgoing-photos', 'view'\)/);
assert.match(migration, /bucket_id = 'outgoing-photos'/);
assert.match(migration, /Explicit reconciliation reads real clock-out records/);
assert.match(migration, /create or replace function public\.cancel_outgoing_request/);
assert.match(migration, /where e\.request_id = request_row\.id/);
assert.match(migration, /An outgoing request with a started event cannot be cancelled/);
assert.match(migration, /request_row\.outgoing_date <> malaysia_today/);
assert.match(migration, /ar\.punched_at >= event_row\.started_at/);
assert.match(migration, /Outgoing cannot be finished after clock-out/);
assert.match(migration, /independent reconciliation RPC must run after successful clock-out/);
assert.match(migration, /punched_at >= e\.started_at/);
assert.match(migration, /punched_at <= e\.ended_at/);
assert.match(migration, /e\.status in \('in_progress', 'completed'\)/);
assert.doesNotMatch(migration, /create trigger[\s\S]*on public\.attendance_records/i);
assert.doesNotMatch(migration, /drop trigger[\s\S]*on public\.attendance_records/i);
assert.doesNotMatch(migration, /returns trigger/i);
assert.doesNotMatch(migration, /create_attendance_record_checked/);
assert.doesNotMatch(migration, /alter table public\.attendance_records/);
assert.match(migration, /revoke all on function public\.outgoing_find_verified_location/);
assert.match(migration, /grant execute on function public\.start_outgoing_event/);

console.log('outgoing Phase 3B migration boundary checks passed');
