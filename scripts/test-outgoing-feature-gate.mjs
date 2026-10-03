import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feature = await readFile(new URL('../src/services/outgoing-feature.service.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../src/services/outgoing.service.ts', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../src/services/outgoing-real-adapter.service.ts', import.meta.url), 'utf8');
const realPanels = await readFile(new URL('../src/components/OutgoingRealPanels.tsx', import.meta.url), 'utf8');
const attendancePage = await readFile(new URL('../src/pages/AttendancePage.tsx', import.meta.url), 'utf8');
const managementPage = await readFile(new URL('../src/pages/AttendanceManagementPage.tsx', import.meta.url), 'utf8');

assert.match(feature, /VITE_ENABLE_OUTGOING_REAL_SERVICE === 'true'/);
assert.match(feature, /VITE_OUTGOING_REAL_SERVICE_APPROVED === 'true'/);
assert.match(feature, /isSupabaseConfigured/);

for (const method of [
  'createRequest', 'cancelRequest', 'reviewRequest', 'listMyRequests', 'listManagedRequests',
  'listReviewHistory', 'getPendingApprovalCount', 'startOutgoing', 'finishOutgoing',
  'handleException', 'reconcileExceptions', 'getPhotoSignedUrl',
]) {
  assert.match(service, new RegExp(`async ${method}[\\s\\S]*?assertOutgoingRealServiceEnabled\\(\\)`));
}

for (const method of [
  'loadEmployeeState', 'createRequest', 'cancelRequest', 'loadReviewHistory', 'startOutgoing',
  'finishOutgoing', 'loadManagementState', 'reviewRequest', 'handleException',
  'reconcileExceptions', 'getPendingApprovalCount', 'getPhotoSignedUrl',
]) {
  assert.match(adapter, new RegExp(`async ${method}[\\s\\S]*?assertOutgoingRealServiceEnabled\\(\\)`));
}

assert.match(adapter, /getOrCreateOutgoingIdempotencyKey/);
assert.match(adapter, /window\.sessionStorage/);
assert.match(adapter, /photoPath/);
assert.match(service, /\$\{phase\}-\$\{values\.idempotencyKey\}\.jpg/);
assert.match(service, /onPhotoUploaded/);
assert.match(realPanels, /outgoingRealAdapter\.createRequest/);
assert.match(realPanels, /outgoingRealAdapter\.reviewRequest/);
assert.match(realPanels, /outgoingRealAdapter\.getPhotoSignedUrl/);
assert.match(attendancePage, /outgoingRealAdapter\.startOutgoing/);
assert.match(attendancePage, /outgoingRealAdapter\.finishOutgoing/);
assert.match(attendancePage, /outgoingRealAdapter\.reconcileExceptions/);
assert.match(attendancePage, /outgoingMode === 'real'/);
assert.match(managementPage, /outgoingPageMode === 'real'/);
console.log('outgoing real-service feature gate checks passed');
