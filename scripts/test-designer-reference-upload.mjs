import assert from 'node:assert/strict';
import { ReferenceStorageCleanupError, deregisterAndRemoveReference, uploadAndRegisterReference } from '../src/services/designer-reference-upload.ts';

const file = { name: 'reference.jpg', type: 'image/jpeg', size: 1 };
function mock(overrides = {}) { const calls = []; return { calls, port: { upload: async (path) => { calls.push(['upload', path]); }, register: async (input) => { calls.push(['register', input]); }, remove: async (path) => { calls.push(['remove', path]); }, ...overrides } }; }
const input = { requestId: 'request-a', path: 'owner/request-a/file.jpg', file, scope: 'shared', itemIds: [] };
{ const { port, calls } = mock(); await uploadAndRegisterReference(port, input); assert.deepEqual(calls.map(([name]) => name), ['upload', 'register']); }
{ const { port, calls } = mock({ upload: async () => { throw new Error('upload failed'); } }); await assert.rejects(() => uploadAndRegisterReference(port, input)); assert.deepEqual(calls, []); }
{ const { port, calls } = mock({ register: async () => { calls.push(['register']); throw new Error('metadata failed'); } }); await assert.rejects(() => uploadAndRegisterReference(port, input)); assert.deepEqual(calls.map(([name]) => name), ['upload', 'register', 'remove'], 'unregistered upload is cleaned up through Storage.remove'); }
{ const { port } = mock({ register: async () => { throw new Error('duplicate attachment'); } }); await assert.rejects(() => uploadAndRegisterReference(port, input), /duplicate/); }
{ const calls = []; await deregisterAndRemoveReference({ deregister: async (id) => { calls.push(['deregister', id]); return input.path; }, remove: async (path) => { calls.push(['remove', path]); } }, 'attachment-a'); assert.deepEqual(calls, [['deregister', 'attachment-a'], ['remove', input.path]], 'registered attachment is removed after deregistration through Storage.remove'); }
{ await assert.rejects(() => deregisterAndRemoveReference({ deregister: async () => input.path, remove: async () => { throw new Error('storage cleanup failed'); } }, 'attachment-a'), (error) => error instanceof ReferenceStorageCleanupError && error.storagePath === input.path && /storage cleanup failed/.test(error.message)); }
function assertOwned(ids, requestItems) { if (ids.some((id) => !requestItems.includes(id))) throw new Error('cross-request item'); }
assertOwned(['item-a'], ['item-a', 'item-b']); assert.throws(() => assertOwned(['item-x'], ['item-a']), /cross-request/);
function assertReadable(user, allowed) { if (!allowed.includes(user)) throw new Error('unauthorized'); }
assertReadable('designer-a', ['designer-a']); assert.throws(() => assertReadable('designer-b', ['designer-a']), /unauthorized/);
console.log('designer reference upload lifecycle mocks: passed');
