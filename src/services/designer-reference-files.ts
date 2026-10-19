export type ReferenceFileKind = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export type ReferenceScope = 'shared' | 'items';
export type ReferenceFileLike = { name: string; type: string; size: number };

const extensions: Record<ReferenceFileKind, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'application/pdf': ['pdf'],
};

export function validateDesignerReferenceFile(file: ReferenceFileLike): ReferenceFileKind {
  const type = file.type.toLowerCase() as ReferenceFileKind;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!(type in extensions) || !extension || !extensions[type].includes(extension)) throw new Error('参考资料仅支持 JPG、JPEG、PNG、WebP 或 PDF 格式。');
  const limit = type === 'application/pdf' ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size <= 0 || file.size > limit) throw new Error(type === 'application/pdf' ? 'PDF 文件大小必须大于 0 且不超过 30MB。' : '图片大小必须大于 0 且不超过 10MB。');
  return type;
}

export function validateReferenceItemSelection(scope: ReferenceScope, itemIds: string[]) {
  if (scope === 'items' && itemIds.length === 0) throw new Error('指定项目参考资料至少需要选择一个项目。');
  if (scope === 'shared' && itemIds.length) throw new Error('共同参考资料不能指定项目。');
}
