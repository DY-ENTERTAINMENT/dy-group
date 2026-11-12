import type { ReviewUploadInspection } from './designer-review-service';

export type UploadRecoveryAction = 'create_and_transfer' | 'transfer' | 'register' | 'needs_file' | 'blocked';

/** Never transfer again until the server has checked the original session. */
export function planReviewUploadRecovery(inspection: ReviewUploadInspection, expectedRevision: number, hasFile: boolean): UploadRecoveryAction {
  if (inspection.state === 'not_found') return hasFile ? 'create_and_transfer' : 'needs_file';
  if (inspection.expectedRevision !== expectedRevision) return 'blocked';
  if (inspection.state === 'consumed') return inspection.objectExists ? 'register' : 'blocked';
  if (!['pending', 'uploading', 'uploaded'].includes(inspection.state)) return 'blocked';
  if (inspection.objectExists) return 'register';
  return hasFile ? 'transfer' : 'needs_file';
}
