import assert from 'node:assert/strict';
import { getEligibleManagementAgents } from '../src/services/management-agent-ranking-eligibility.ts';

const employees = [
  { id: 'active-with-host', status: 'active' },
  { id: 'active-no-host', status: 'active' },
  { id: 'inactive-with-host', status: 'inactive' },
  { id: 'active-douyin-host', status: 'active' },
];
const tiktok = [
  { agent_employee_id: 'active-with-host', agent_name: 'TikTok zero revenue', managed_creator_count: 1 },
  { agent_employee_id: 'active-no-host', agent_name: 'No host', managed_creator_count: 0 },
  { agent_employee_id: 'inactive-with-host', agent_name: 'Former agent', managed_creator_count: 2 },
];
const douyin = [
  { agent_employee_id: 'active-douyin-host', agent_name: 'Douyin zero revenue', managed_creator_count: 1 },
  { agent_employee_id: 'inactive-with-host', agent_name: 'Former agent', managed_creator_count: 1 },
];

const eligible = getEligibleManagementAgents(employees, tiktok, douyin);
assert.deepEqual(eligible, [
  { id: 'active-with-host', name: 'TikTok zero revenue' },
  { id: 'active-douyin-host', name: 'Douyin zero revenue' },
]);
assert.equal(new Set(eligible.map((agent) => agent.id)).size, eligible.length, 'both platforms must share one de-duplicated eligibility roster');
console.log('management agent ranking eligibility: passed');
