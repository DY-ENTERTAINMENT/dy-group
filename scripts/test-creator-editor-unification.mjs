import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const assertContains = (source, expected, message) => { if (!source.includes(expected)) throw new Error(message); };
const [page, service, migration] = await Promise.all([read('src/pages/ScoutPage.tsx'),read('src/services/scout.service.ts'),read('supabase/migrations/202610120001_upgrade_legacy_creator_profile_to_entity.sql')]);
assertContains(page, 'setLegacyCreatorUpgrade(creator);', 'Legacy edit must require an explicit upgrade confirmation.');
assertContains(page, '确认升级并编辑', 'Legacy upgrade confirmation button is missing.');
assertContains(page, 'await openCreatorEntityEdit(upgradedProfile, result.creator_entity_id);', 'Upgraded profiles must open the shared editor.');
assertContains(page, '已重新读取服务器资料', 'Partial-save failures must refresh server state before reporting.');
assertContains(service, "revenue_input_mode: p.revenue_input_mode ?? 'direct'", 'Revenue settings must retain the profile input mode.');
assertContains(service, 'upgrade_legacy_creator_profile_to_entity', 'Legacy upgrade RPC is not called by the service.');
assertContains(migration, "current_user_has_permission('management-streamer-stats', 'use')", 'RPC permission guard is missing.');
assertContains(migration, 'current_user_can_access_region(v_profile.region_id)', 'RPC region guard is missing.');
assertContains(migration, 'for update;', 'RPC must lock the legacy profile for concurrent upgrades.');
assertContains(migration, 'if v_profile.creator_entity_id is not null then', 'RPC must be idempotent for an already linked profile.');
assertContains(migration, 'set creator_entity_id = v_entity_id', 'RPC must link the original profile instead of cloning it.');
assertContains(migration, "'existing_creator'", 'RPC must identify the upgraded row as historical data.');
console.log('creator editor unification static checks passed');

// Execute the real service implementation, replacing only its Supabase import.
const compiled = ts.transpileModule(service.replace("import { supabase } from '../lib/supabase';", 'const supabase = globalThis.__creatorEditorTestDb;'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
let response;
globalThis.__creatorEditorTestDb = { rpc: async (name, args) => { assert.equal(name, 'upgrade_legacy_creator_profile_to_entity'); assert.equal(args.p_creator_profile_id, profileId); return response; } };
const { scoutService } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const profileId = '10000000-0000-0000-0000-000000000001';
const entityId = '20000000-0000-0000-0000-000000000001';
const row = { creator_entity_id: entityId, creator_profile_id: profileId, created: true };
response = { data: [row], error: null };
assert.deepEqual(await scoutService.upgradeLegacyCreatorProfileToEntity(profileId), row);
for (const data of [[], [row, row], row, null, [null], [{ ...row, created: 'true' }], [{ ...row, creator_entity_id: 'invalid' }], [{ ...row, creator_profile_id: entityId }]]) {
  response = { data, error: null };
  await assert.rejects(() => scoutService.upgradeLegacyCreatorProfileToEntity(profileId), /无法确认结果/);
}
response = { data: [row], error: { message: 'Network response lost' } };
await assert.rejects(() => scoutService.upgradeLegacyCreatorProfileToEntity(profileId), /无法确认.*刷新服务器资料后重试/);
// A manual retry receives the original entity from the idempotent server RPC.
response = { data: [{ ...row, created: false }], error: null };
const repeated = await scoutService.upgradeLegacyCreatorProfileToEntity(profileId);
assert.equal(repeated.creator_entity_id, entityId);
assert.equal(repeated.creator_profile_id, profileId);
assert.equal(repeated.created, false);
// Execute the actual page confirmation handler with server refresh/editor mocks.
const pageAst = ts.createSourceFile('ScoutPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
const visit = (node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'confirmLegacyCreatorUpgrade') handler = node.getText(pageAst); ts.forEachChild(node, visit); };
visit(pageAst);
assert.ok(handler);
const handlerJs = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let opened;
const errors = [];
const runConfirmation = new Function('legacyCreatorUpgrade', 'scoutService', 'loadData', 'openCreatorEntityEdit', 'setSaving', 'setError', 'setLegacyCreatorUpgrade', 'getErrorMessage', `${handlerJs}; return confirmLegacyCreatorUpgrade();`);
await runConfirmation({ id: profileId }, scoutService, async () => [{ id: profileId, creator_entity_id: entityId }], async (profile, id) => { opened = { profile, id }; }, () => {}, (value) => errors.push(value), () => {}, (error) => error.message);
assert.equal(opened.id, entityId);
assert.equal(opened.profile.id, profileId);
response = { data: [], error: null };
opened = null;
await runConfirmation({ id: profileId }, scoutService, async () => [], async () => { opened = true; }, () => {}, (value) => errors.push(value), () => {}, (error) => error.message);
assert.equal(opened, null);
assert.match(errors.at(-1), /返回行数异常/);
delete globalThis.__creatorEditorTestDb;
console.log('creator upgrade RPC response behavior checks passed');
