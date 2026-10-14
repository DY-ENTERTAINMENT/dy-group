type ReportInput = {
  startDate: string; endDate: string; managerEmployeeId?: string; platform?: string;
  creatorType?: string; regionId?: string; status?: string; revenueCycle?: string;
};
type RpcClient = { rpc: (name: string, input: Record<string, unknown>) => PromiseLike<{ data: any[] | null; error: unknown }> };
export async function readManagementRevenueRoster(db: RpcClient, input: ReportInput): Promise<any[]> {
  const params = { p_start_date: input.startDate, p_end_date: input.endDate,
    p_manager_employee_id: input.managerEmployeeId || null, p_platform: input.platform || null,
    p_creator_type: input.creatorType || null, p_region_id: input.regionId || null,
    p_status: input.status || null, p_limit: 500 };
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.rpc('list_management_revenue_records_e', {
      ...params, p_offset: offset, p_revenue_cycle: input.revenueCycle === 'monthly' ? null : input.revenueCycle || null,
    });
    if (error) throw error;
    rows.push(...(data ?? []).map(row => row.record));
    if ((data ?? []).length < 500) break;
  }
  const unknownIds = new Set(rows.filter(row => row.cycle_source === 'LEGACY_UNKNOWN').map(row => row.creator_profile_id));
  const currentMonthly = new Set<string>();
  if (unknownIds.size) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.rpc('list_management_revenue_canonical_records_v2', {
        ...params, p_manager_employee_id: null, p_status: null, p_offset: offset, p_revenue_cycle: 'monthly',
      });
      if (error) throw error;
      for (const row of data ?? []) if (unknownIds.has(row.creator_profile_id)) currentMonthly.add(row.creator_profile_id);
      if ((data ?? []).length < 500) break;
    }
  }
  return rows.map(row => ({ ...row,
    effective_revenue_cycle: row.creator_revenue_cycle,
    current_revenue_cycle: row.cycle_source === 'LEGACY_UNKNOWN' && currentMonthly.has(row.creator_profile_id) ? 'monthly' : undefined,
    creator_revenue_cycle: row.cycle_source === 'LEGACY_UNKNOWN' && currentMonthly.has(row.creator_profile_id) ? 'monthly' : row.creator_revenue_cycle,
  })).filter(row => !input.revenueCycle || row.creator_revenue_cycle === input.revenueCycle);
}
