import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/services/leave.service.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const records = Array.from({ length: 1205 }, (_, i) => ({
  id: String(2000 - i).padStart(8, '0') + '-0000-0000-0000-000000000000',
  created_at: `2020-01-${String(31 - Math.floor(i / 100)).padStart(2, '0')}T00:00:00+00:00`,
  profile_id: 'employee-a', employee_id: 'old-employee', employees: null,
}));
records.push({ ...records[0], id: 'ffffffff-0000-0000-0000-000000000000', profile_id: 'employee-b' });
let user = 'employee-a';
let failPage = false;
let calls = 0;
const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) },
  from(table) {
    assert.equal(table, 'leave_requests');
    let profile, cursor;
    const query = {
      select() { return this; },
      eq(column, value) { assert.equal(column, 'profile_id'); profile = value; return this; },
      order() { return this; }, limit() { return this; },
      or(value) {
        const match = value.match(/^created_at\.lt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.lt\.([^)]+)\)$/);
        assert.ok(match); cursor = { created_at: match[1], id: match[2] }; return this;
      },
      then(resolve) {
        calls++;
        if (failPage && calls === 2) return resolve({ data: null, error: new Error('page failed') });
        const data = records.filter(r => r.profile_id === profile && (!cursor || r.created_at < cursor.created_at || (r.created_at === cursor.created_at && r.id < cursor.id))).slice(0, 137);
        return resolve({ data, error: null });
      },
    };
    return query;
  },
};
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => name === '../lib/supabase' ? { supabase } : {}, console });
const list = exports.leaveService.listMyLeaveRequests;
const result = await list('employee-a');
assert.equal(result.length, 1205);
assert.equal(new Set(result.map(r => r.id)).size, 1205);
assert.ok(result.every(r => r.profile_id === 'employee-a'));
assert.ok(calls > 9);
calls = 0; failPage = true;
await assert.rejects(list('employee-a'), /page failed/);
calls = 0; failPage = false; user = 'employee-b';
await assert.rejects(list('employee-a'), /无法确认当前登录员工/);
assert.equal(calls, 0);
console.log('分页、同时间排序、较低服务端上限、失败及身份边界测试通过');
