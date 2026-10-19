/**
 * The feature is available wherever the reviewed database migration exists.
 * Database RLS and the request-scoped RPCs remain the authorization boundary.
 */
export const designerReferenceUploadsEnabled = true;

export function canRemoveDesignerReference(status: string, isRequestOwner: boolean, enabled = designerReferenceUploadsEnabled) {
  return enabled && isRequestOwner && status === 'unclaimed';
}
