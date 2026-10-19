import type { ReferenceScope } from './designer-reference-files';

export type ReferenceUploadPort = {
  upload(path: string, file: File): Promise<void>;
  register(input: { requestId: string; path: string; file: File; scope: ReferenceScope; itemIds: string[] }): Promise<void>;
  remove(path: string): Promise<void>;
};

export async function uploadAndRegisterReference(port: ReferenceUploadPort, input: { requestId: string; path: string; file: File; scope: ReferenceScope; itemIds: string[] }) {
  await port.upload(input.path, input.file);
  try {
    await port.register(input);
  } catch (error) {
    await port.remove(input.path).catch(() => undefined);
    throw error;
  }
}

export type ReferenceDeletePort = {
  deregister(attachmentId: string): Promise<string>;
  remove(path: string): Promise<void>;
};

export class ReferenceStorageCleanupError extends Error {
  readonly storagePath: string;

  constructor(storagePath: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : '参考资料文件清理失败。');
    this.name = 'ReferenceStorageCleanupError';
    this.storagePath = storagePath;
  }
}

/**
 * Removes metadata first, then delegates physical object deletion to the
 * Storage API. The database policy only allows this for the request owner
 * while the request is unclaimed; a failed Storage deletion is intentionally
 * surfaced for the narrow orphan-object audit rather than being hidden.
 */
export async function deregisterAndRemoveReference(port: ReferenceDeletePort, attachmentId: string) {
  const path = await port.deregister(attachmentId);
  try {
    await port.remove(path);
  } catch (error) {
    throw new ReferenceStorageCleanupError(path, error);
  }
}
