import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202610060001_outgoing_employee_ownership.sql', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/services/outgoing.service.ts', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/OutgoingRealPanels.tsx', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../src/services/outgoing-real-adapter.service.ts', import.meta.url), 'utf8');

for (const fn of ['list_my_outgoing_requests', 'list_my_outgoing_request_review_history']) {
  assert.match(migration, new RegExp(`function public\\.${fn}`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
}
assert.match(migration, /r\.profile_id = auth\.uid\(\)/);
assert.match(migration, /security definer/);
assert.match(service, /rpc\('list_my_outgoing_requests'\)/);
assert.match(service, /request\.profile_id === profileId/);
assert.match(service, /rpc\('list_my_outgoing_request_review_history'/);
assert.match(panel, /status === 'cancelled'\) return false/);
assert.match(panel, /: current \? <OutgoingEmployeeRequestCard[\s\S]*: null/);
assert.match(adapter, /status === 'cancelled'\) return false/);

console.log('outgoing employee ownership checks passed');
