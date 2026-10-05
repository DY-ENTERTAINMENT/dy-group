import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getOutgoingEvent, getOutgoingLifecycleStatus } from '../src/services/outgoing-event-relation.ts';

const event = { id: 'event-1', status: 'in_progress' };
const request = (outgoing_events) => ({ id: 'request-1', outgoing_events });

// PostgREST to-one response: before start it is null, after start it is an object.
assert.equal(getOutgoingEvent(request(null)), null, 'pending request must accept a null event');
assert.equal(getOutgoingEvent(request(undefined)), null, 'approved request must accept an absent event');
assert.deepEqual(getOutgoingEvent(request(event)), event, 'in-progress request must read its to-one event');
assert.deepEqual(getOutgoingEvent(request({ ...event, status: 'completed' })), { ...event, status: 'completed' }, 'completed request must read its event');

// Retain compatibility with a stale PostgREST relationship cache returning an array.
assert.deepEqual(getOutgoingEvent(request([event])), event, 'legacy array response must normalize');
assert.equal(getOutgoingEvent(request([])), null, 'empty legacy array must not crash');

// Employee cards, management cards, details, and lifecycle counts share this
// canonical shape.  A mixed management result must keep no-event requests.
const mixedManagementRows = [
  { status: 'pending', outgoing_events: null },
  { status: 'approved', outgoing_events: null },
  { status: 'approved', outgoing_events: event },
  { status: 'approved', outgoing_events: { ...event, status: 'completed' } },
];
assert.deepEqual(mixedManagementRows.map(getOutgoingEvent), [null, null, event, { ...event, status: 'completed' }]);
assert.deepEqual(mixedManagementRows.map((row) => getOutgoingLifecycleStatus(row)), ['pending', 'approved', 'in_progress', 'completed']);

const service = await readFile(new URL('../src/services/outgoing.service.ts', import.meta.url), 'utf8');
const panels = await readFile(new URL('../src/components/OutgoingRealPanels.tsx', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../src/services/outgoing-real-adapter.service.ts', import.meta.url), 'utf8');
assert.match(service, /outgoing_events: OutgoingEvent \| null/);
assert.match(service, /normalizeOutgoingRequests/);
assert.match(service, /getOutgoingEvent\(row\)\?\.status/);
for (const source of [panels, adapter]) assert.doesNotMatch(source, /outgoing_events\s*\[\s*0\s*\]|outgoing_events\.some/);
assert.match(panels, /getOutgoingEvent\(request\)/);
assert.match(adapter, /getOutgoingLifecycleStatus\(request\)/);

console.log('outgoing event relation normalization checks passed');
