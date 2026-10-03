import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
const settingsSection = source.slice(source.indexOf('const explicitHrPermissionItems'), source.indexOf('const agentSensitivePermissionItems'));

for (const [key, label] of [
  ['outgoing-application', '外出申请'],
  ['outgoing-approval', '外出审批'],
  ['outgoing-management', '外出管理'],
  ['outgoing-exception-handling', '外出异常处理'],
  ['outgoing-photos', '查看外出打卡照片'],
  ['outgoing-settings', '外出设置'],
]) {
  assert.match(settingsSection, new RegExp(`key: '${key}'[\\s\\S]*?name: '${label}'[\\s\\S]*?parentKey: 'hr'[\\s\\S]*?level: 1[\\s\\S]*?explicitOnly: true`));
}

assert.match(settingsSection, /key: 'outgoing-photos'[\s\S]*?viewOnly: true[\s\S]*?explicitOnly: true/);

assert.match(source, /childItems = items\.filter\(\(item\) => item\.parentKey === key && !item\.explicitOnly/);
assert.match(source, /items\s*\.filter\(\(item\) => item\.parentKey && defaultKeys\.includes\(item\.parentKey\)[\s\S]*?\.filter\(\(item\) => !item\.explicitOnly\)/);
assert.match(source, /mergePermissionState\(defaultPermissions, savedPermissions\)/);
assert.match(source, /permissionManagementService\.getEmployeePermissions/);
assert.match(source, /permissionManagementService\.saveEmployeePermissions/);

console.log('outgoing permission settings checks passed');
