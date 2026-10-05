import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/services/attendance-day.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const logic = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const record = (id, punch_type, time) => ({ id, punch_type, punched_at: time });

assert.deepEqual(logic.sortAttendanceRecords([record('b', 'clock_in', '2026-10-02T01:00:00Z'), record('a', 'clock_in', '2026-10-02T01:00:00Z')]).map((item) => item.id), ['a', 'b']);
assert.equal(logic.summarizeAttendanceDay([]).status, 'not_started');
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z')]).status, 'working');
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'break_start', '2026-10-02T02:00:00Z')]).status, 'on_break');
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'break_start', '2026-10-02T02:00:00Z'), record('3', 'break_end', '2026-10-02T03:00:00Z'), record('4', 'break_start', '2026-10-02T04:00:00Z')]).status, 'on_break');
assert.equal(logic.summarizeAttendanceDay([record('1', 'break_start', '2026-10-02T01:00:00Z')]).anomalies.includes('缺少上班打卡后开始休息'), true);
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'clock_in', '2026-10-02T02:00:00Z')]).anomalies.includes('重复上班打卡'), true);
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'break_end', '2026-10-02T02:00:00Z')]).anomalies.includes('缺少开始休息记录'), true);
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'clock_out', '2026-10-02T02:00:00Z')]).status, 'clocked_out');
const mistakenClockOut = { ...record('3', 'clock_out', '2026-10-02T03:00:00Z'), clockOutRecovery: { id: 'recovery' } };
const breakMistakeRecords = [record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'break_start', '2026-10-02T02:00:00Z'), mistakenClockOut];
assert.equal(logic.summarizeAttendanceDay(breakMistakeRecords).status, 'on_break');
assert.equal(logic.findRecoverableBreakClockOut([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'break_start', '2026-10-02T02:00:00Z'), record('3', 'clock_out', '2026-10-02T03:00:00Z')])?.id, '3');
assert.equal(logic.findRecoverableBreakClockOut([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'clock_out', '2026-10-02T02:00:00Z')]), null);
assert.equal(logic.findRecoverableBreakClockOut([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'break_start', '2026-10-02T02:00:00Z'), record('3', 'break_end', '2026-10-02T02:30:00Z'), record('4', 'clock_out', '2026-10-02T03:00:00Z')]), null);
assert.equal(logic.findRecoverableBreakClockOut([...breakMistakeRecords, record('4', 'break_end', '2026-10-02T04:00:00Z')]), null);
assert.equal(logic.summarizeAttendanceDay([record('1', 'clock_in', '2026-10-02T01:00:00Z'), record('2', 'clock_out', '2026-10-02T02:00:00Z'), record('3', 'break_start', '2026-10-02T03:00:00Z')]).anomalies.includes('下班后仍有打卡记录'), true);
assert.equal(logic.mytDateKey('2026-10-01T16:30:00Z'), '2026-10-02');

const locationSource = (await readFile(new URL('../src/services/attendance-location.service.ts', import.meta.url), 'utf8')).replace("import { supabase } from '../lib/supabase';", '');
const locationOutput = ts.transpileModule(locationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const location = await import(`data:text/javascript;base64,${Buffer.from(locationOutput).toString('base64')}`);
assert.match(location.getGeoPermissionGuidance('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari'), /iPhone 定位服务.*Safari/);
assert.match(location.getGeoPermissionGuidance('Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit Chrome'), /开启设备定位.*当前浏览器/);
assert.match(location.getGeoPermissionGuidance('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome'), /系统定位设置.*当前网站/);
assert.match(location.getGeoPermissionGuidance('UnknownAgent/1.0'), /设备定位服务及当前网站/);
console.log('attendance-day and location-guidance tests passed');
