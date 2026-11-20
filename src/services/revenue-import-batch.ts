export function flagDuplicateUids<T extends { uid: string; issue?: string }>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.uid) counts.set(row.uid, (counts.get(row.uid) ?? 0) + 1);
  return rows.map(row => row.uid && (counts.get(row.uid) ?? 0) > 1
    ? { ...row, issue: [row.issue, '文件内 UID 重复'].filter(Boolean).join('；') }
    : row);
}
export function splitImportBatches<T>(rows: T[], limit = 500): T[][] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid batch limit');
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += limit) batches.push(rows.slice(i, i + limit));
  return batches;
}
