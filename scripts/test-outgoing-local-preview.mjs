import assert from 'node:assert/strict';

const values = new Map();
const listeners = new Map();
globalThis.window = {
  location: { hostname: 'localhost' },
  localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  removeEventListener: (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)),
  dispatchEvent: (event) => { for (const listener of listeners.get(event.type) ?? []) listener(event); return true; },
};

const { isOutgoingLocalPreviewEnabled, outgoingLocalPreviewService } = await import('../src/services/outgoing-local-preview.service.ts');
assert.equal(isOutgoingLocalPreviewEnabled(), true);
window.location.hostname = '::1';
assert.equal(isOutgoingLocalPreviewEnabled(), true);
window.location.hostname = 'localhost';
const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const base = { profileId: 'employee-1', employeeName: '测试员工', regionId: 'region-1', regionCode: 'KUL', outgoingDate: localToday, plannedStartTime: '14:00', plannedReturnTime: '16:30', outgoingType: 'client_visit', location: '测试地点', reason: '测试外出', relatedContact: null, remarks: null };

const pending = outgoingLocalPreviewService.create(base);
assert.equal(outgoingLocalPreviewService.listForProfile('employee-1').length, 1);
assert.throws(() => outgoingLocalPreviewService.create({ ...base, plannedStartTime: '15:00', plannedReturnTime: '17:00' }), /时间重叠/);
assert.throws(() => outgoingLocalPreviewService.review(pending.id, 'rejected', 'HR'), /拒绝原因/);
assert.equal(outgoingLocalPreviewService.review(pending.id, 'approved', 'HR').status, 'approved');
assert.throws(() => outgoingLocalPreviewService.review(pending.id, 'approved', 'HR'), /已处理/);
assert.equal(outgoingLocalPreviewService.getMockAttendanceStatus('employee-1', localToday), null);
outgoingLocalPreviewService.setMockAttendanceStatus('employee-1', localToday, 'working');
assert.equal(outgoingLocalPreviewService.getMockAttendanceStatus('employee-1', localToday), 'working');
assert.throws(() => outgoingLocalPreviewService.start(pending.id, 'employee-1', 'on_break'), /模拟工作中/);
assert.equal(outgoingLocalPreviewService.start(pending.id, 'employee-1', 'working').lifecycle, 'in_progress');
assert.throws(() => outgoingLocalPreviewService.start(pending.id, 'employee-1', 'working'), /不能开始/);
assert.equal(outgoingLocalPreviewService.finish(pending.id, 'employee-1').lifecycle, 'completed');
assert.throws(() => outgoingLocalPreviewService.finish(pending.id, 'employee-1'), /不能结束/);

const rejected = outgoingLocalPreviewService.create({ ...base, plannedStartTime: '17:00', plannedReturnTime: '18:00', reason: '拒绝测试' });
assert.equal(outgoingLocalPreviewService.review(rejected.id, 'rejected', 'HR', '时间冲突').reviewNote, '时间冲突');
const cancelled = outgoingLocalPreviewService.create({ ...base, plannedStartTime: '18:00', plannedReturnTime: '19:00', reason: '取消测试' });
assert.equal(outgoingLocalPreviewService.cancel(cancelled.id, 'employee-1').status, 'cancelled');
const exception = outgoingLocalPreviewService.create({ ...base, plannedStartTime: '19:00', plannedReturnTime: '20:00', reason: '异常测试' });
outgoingLocalPreviewService.review(exception.id, 'approved', 'HR');
outgoingLocalPreviewService.start(exception.id, 'employee-1', 'working');
assert.equal(outgoingLocalPreviewService.markException(exception.id).lifecycle, 'exception');
assert.ok(outgoingLocalPreviewService.handleException(exception.id, 'HR').exceptionHandledAt);
assert.ok(values.size > 0, 'localStorage must retain test records after refresh');
window.location.hostname = 'example.com';
assert.equal(isOutgoingLocalPreviewEnabled(), false);
assert.throws(() => outgoingLocalPreviewService.getMockAttendanceStatus('employee-1', localToday), /仅允许/);

console.log('outgoing localStorage workflow tests passed');
