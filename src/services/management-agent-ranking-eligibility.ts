export type ManagementAgentStatus = { id: string; status: string | null | undefined };

export type ManagementAgentRosterRow = {
  agent_employee_id: string;
  agent_name: string;
  managed_creator_count: number;
};

export type EligibleManagementAgent = { id: string; name: string };

/**
 * The ranking is a current-roster view: an active employee must currently own
 * at least one valid creator on either platform. Both tabs receive this same
 * merged roster, so platform-specific historical revenue cannot change it.
 */
export function getEligibleManagementAgents(
  employees: ManagementAgentStatus[],
  tiktokRows: ManagementAgentRosterRow[],
  douyinRows: ManagementAgentRosterRow[],
): EligibleManagementAgent[] {
  const activeEmployeeIds = new Set(employees.filter((employee) => employee.status === 'active').map((employee) => employee.id));
  const agents = new Map<string, EligibleManagementAgent>();

  [...tiktokRows, ...douyinRows].forEach((row) => {
    if (!activeEmployeeIds.has(row.agent_employee_id) || row.managed_creator_count < 1) return;
    if (!agents.has(row.agent_employee_id)) agents.set(row.agent_employee_id, { id: row.agent_employee_id, name: row.agent_name });
  });

  return Array.from(agents.values());
}
