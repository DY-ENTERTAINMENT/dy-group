import type { OutgoingEvent, OutgoingEventStatus, OutgoingRequestStatus } from '../types/database';

/**
 * The request_id uniqueness constraint makes this PostgREST embed a to-one
 * relation.  Older cached schema metadata can still serialize it as an array,
 * so keep the boundary tolerant while exposing one canonical value to the UI.
 */
export type OutgoingEventRelation = OutgoingEvent | OutgoingEvent[] | null | undefined;

export function getOutgoingEvent(value: { outgoing_events?: OutgoingEventRelation }): OutgoingEvent | null {
  const relation = value.outgoing_events;
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

export type OutgoingLifecycleStatus = OutgoingRequestStatus | OutgoingEventStatus;

export function getOutgoingLifecycleStatus(value: { status: OutgoingRequestStatus; outgoing_events?: OutgoingEventRelation }): OutgoingLifecycleStatus {
  return getOutgoingEvent(value)?.status ?? value.status;
}
