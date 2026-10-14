import type { RevenueCycle, RevenueMonthContext } from './revenue-cycle.service';

// A current setting classifies the roster; it never establishes historical applicability.
export function rosterCycle(current: RevenueCycle | undefined, context: RevenueMonthContext): RevenueCycle | undefined {
  return context.effective_cycle ?? (context.cycle_source === 'LEGACY_UNKNOWN' && current === 'monthly' ? 'monthly' : undefined);
}

export function canWriteMonthly(context: RevenueMonthContext | undefined): boolean {
  return Boolean(context?.can_write && isVerifiedMonthly(context));
}

export function isVerifiedMonthly(context: RevenueMonthContext | undefined): boolean {
  return context?.cycle_source === 'VERIFIED' && context.effective_cycle === 'monthly';
}

export function malaysiaMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return parts.find(part => part.type === 'year')!.value + '-' + parts.find(part => part.type === 'month')!.value;
}

export function baselineInput(profileId: string, month: string, evidence: string, confirmed: boolean, now = new Date()) {
  if (!profileId || month !== malaysiaMonth(now) || !confirmed || evidence.trim().length < 20) throw new Error('请确认真实资料，并填写至少 20 字的本月核验依据。');
  return { p_profile_id: profileId, p_effective_month: month + '-01', p_cycle: 'monthly', p_evidence: evidence.trim() };
}
