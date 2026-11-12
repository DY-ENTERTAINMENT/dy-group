export type ReviewStageStatus = 'in_progress' | 'revision' | 'awaiting_agent_confirmation' | 'completed';
export type ReviewImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ReviewStageKey = { requestId: string; stageId: string; itemId: string | null };
export type ReviewImage = { id: string; originalName: string; contentType: ReviewImageType; sizeBytes: number };
export type ReviewSnapshot = {
  key: ReviewStageKey;
  status: ReviewStageStatus;
  draftRevision: number;
  pendingSubmissionId: string | null;
  finalSubmissionId: string | null;
  images: ReviewImage[];
  submittedNote: string | null;
  latestFeedback: string | null;
  feedbackCount: number;
};

export type CreateReviewUpload = {
  key: ReviewStageKey;
  uploadTaskId: string;
  expectedRevision: number;
  file: File;
};
export type ReviewUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'registering' | 'consumed' | 'cleanup_requested' | 'cleanup_failed' | 'cleaned' | 'expired' | 'cancelled';
export type ReviewUploadSession = { uploadTaskId: string; storagePath: string; status: ReviewUploadStatus; expiresAt: string };
export type TransferReviewUpload = { key: ReviewStageKey; session: ReviewUploadSession; file: File };
export type RegisterReviewUpload = { key: ReviewStageKey; uploadTaskId: string; expectedRevision: number };
export type CleanupReviewUpload = { key: ReviewStageKey; uploadTaskId: string };
export type ReviewUploadInspection = { state: ReviewUploadStatus | 'not_found'; expectedRevision: number | null; objectExists: boolean };
export type DeleteReviewImage = {
  key: ReviewStageKey;
  imageId: string;
  expectedRevision: number;
  idempotencyKey: string;
};
export type SubmitReview = {
  key: ReviewStageKey;
  expectedRevision: number;
  operationId: string;
  note: string | null;
};
export type ReviewDecision = { key: ReviewStageKey; expectedSubmissionId: string };
export type ReturnReview = ReviewDecision & { feedback: string };
export type ReviewImageUrl = { url: string; expiresAt: string };

/** Operations must be enforced server-side; client-provided IDs confer no access. */
export interface DesignerReviewService {
  readCurrent(key: ReviewStageKey): Promise<ReviewSnapshot>;
  createUpload(input: CreateReviewUpload): Promise<ReviewUploadSession>;
  transferUpload(input: TransferReviewUpload): Promise<void>;
  registerUpload(input: RegisterReviewUpload): Promise<ReviewImage>;
  cleanupUpload(input: CleanupReviewUpload): Promise<void>;
  inspectUpload(input: CleanupReviewUpload): Promise<ReviewUploadInspection>;
  deleteImage(input: DeleteReviewImage): Promise<void>;
  submit(input: SubmitReview): Promise<{ submissionId: string }>;
  requestChanges(input: ReturnReview): Promise<void>;
  confirmFinal(input: ReviewDecision): Promise<void>;
  imageUrl(key: ReviewStageKey, imageId: string, download: boolean): Promise<ReviewImageUrl>;
}

export class DesignerReviewUnavailableError extends Error {
  readonly code = 'DESIGNER_REVIEW_UNAVAILABLE';
  constructor() {
    super('设计审核新接口尚未启用。');
    this.name = 'DesignerReviewUnavailableError';
  }
}

async function live(): Promise<DesignerReviewService> {
  return (await import('./designer-review-rpc')).designerReviewRpcService;
}

export const designerReviewService: DesignerReviewService = Object.freeze<DesignerReviewService>({
  async readCurrent(key) { return (await live()).readCurrent(key); },
  async createUpload(input) { return (await live()).createUpload(input); },
  async transferUpload(input) { return (await live()).transferUpload(input); },
  async registerUpload(input) { return (await live()).registerUpload(input); },
  async cleanupUpload(input) { return (await live()).cleanupUpload(input); },
  async inspectUpload(input) { return (await live()).inspectUpload(input); },
  async deleteImage(input) { return (await live()).deleteImage(input); },
  async submit(input) { return (await live()).submit(input); },
  async requestChanges(input) { return (await live()).requestChanges(input); },
  async confirmFinal(input) { return (await live()).confirmFinal(input); },
  async imageUrl(key, imageId, download) { return (await live()).imageUrl(key, imageId, download); },
});
