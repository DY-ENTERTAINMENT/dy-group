import * as XLSX from 'xlsx';

const text = (cell: XLSX.CellObject | undefined) => String(cell?.v ?? '').trim();
const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();

export function findImportHeaders(sheet: XLSX.WorkSheet, range: XLSX.Range, platform: 'tiktok' | 'douyin') {
  const fields = platform === 'tiktok'
    ? { uid: ['主播 ID', 'TikTok ID', '报表主播 ID'], amount: ['钻石数'], username: ['主播用户名'], period: ['数据周期'] }
    : { uid: ['主播ID'], amount: ['总音浪'], username: [] as string[], period: [] as string[] };
  const required = platform === 'tiktok' ? ['uid', 'amount', 'period'] : ['uid', 'amount'];
  const labels: Record<string, string> = { uid: '主播 ID', amount: platform === 'tiktok' ? '钻石数' : '总音浪', username: '主播用户名', period: '数据周期' };
  let best: { row: number; matches: Record<string, number[]>; score: number } | undefined;
  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 30); row++) {
    const matches: Record<string, number[]> = {};
    for (const [key, aliases] of Object.entries(fields)) {
      matches[key] = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const value = normalize(text(sheet[XLSX.utils.encode_cell({ r: row, c: col })]));
        if (value && aliases.some(alias => normalize(alias) === value)) matches[key].push(col);
      }
    }
    const score = Object.values(matches).filter(cols => cols.length > 0).length;
    if (!best || score > best.score) best = { row, matches, score };
    if (required.every(key => matches[key].length > 0)) { best = { row, matches, score }; break; }
  }
  const matches = best!.matches;
  const duplicate = Object.keys(matches).filter(key => matches[key].length > 1);
  const missing = required.filter(key => matches[key].length === 0);
  const problems = [duplicate.length ? `重复字段：${duplicate.map(key => labels[key]).join('、')}` : '', missing.length ? `未识别必要字段：${missing.map(key => labels[key]).join('、')}` : ''].filter(Boolean);
  if (problems.length) throw new Error(`${problems.join('；')}。请检查首个工作表的表头。`);
  return { row: best!.row, uid: matches.uid[0], amount: matches.amount[0], username: matches.username[0], period: matches.period[0] };
}

export type ReportPeriod = { raw: string; start?: string; end?: string; error?: string };

// Excel stores a date cell as one serial date, not a range. Decode it using
// the workbook's date system without converting through the local timezone.
export function parseReportPeriod(cell: XLSX.CellObject | undefined, date1904 = false): ReportPeriod {
  if (!cell || cell.v == null || cell.v === '') return { raw: '', error: '数据周期为空' };
  if (cell.f) return { raw: String(cell.v ?? ''), error: '数据周期为公式，无法核验' };
  if (cell.t === 'n') {
    const ssf = XLSX.SSF ?? (Reflect.get(XLSX, 'default') as typeof XLSX).SSF;
    const date = ssf.parse_date_code(Number(cell.v), { date1904 });
    const raw = date ? `${String(date.y).padStart(4,'0')}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}` : String(cell.v);
    return { raw: `${String(cell.v)}（日期：${raw}）`, error: 'Excel 日期单元格仅包含一个日期，缺少完整起止日期' };
  }
  if (cell.t !== 's') return { raw: String(cell.v), error: '数据周期格式无法识别' };
  const raw = String(cell.v).trim();
  const matches = [...raw.matchAll(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g)];
  const dates = matches.map(match => {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
  });
  if (dates.length !== 2 || dates.some(date => !date) || dates[0] > dates[1]) return { raw, error: '数据周期不完整或无法识别：需要包含有效的开始和结束日期' };
  return { raw, start: dates[0], end: dates[1] };
}

export function checkReportPeriod(value: string, start: string, end: string): string | undefined {
  const period = parseReportPeriod({ t: 's', v: value });
  if (period.error) return period.error;
  if (period.start !== start || period.end !== end) return `数据周期 ${period.start} 至 ${period.end} 与所选周期 ${start} 至 ${end} 不一致`;
  return undefined;
}

export function assessReportPeriods(periods: ReportPeriod[], start: string, end: string) {
  const distinct = new Set(periods.filter(p => !p.error).map(p => `${p.start} 至 ${p.end}`));
  const mixed = distinct.size > 1;
  const issues = periods.map(p => p.error || (mixed ? '文件内各行数据周期不一致' : p.start !== start || p.end !== end ? `数据周期 ${p.start} 至 ${p.end} 与所选周期 ${start} 至 ${end} 不一致` : undefined));
  return { issues, actual: distinct.size === 1 && periods.every(p => !p.error) ? [...distinct][0] : '无法确认', abnormalCount: issues.filter(Boolean).length, blocked: issues.some(Boolean) };
}
