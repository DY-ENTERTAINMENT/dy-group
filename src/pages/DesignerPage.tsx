import { DesignerIntakeWorkflowV2, DesignerWorkflow } from '../components/DesignerRequestWorkflow';

export type DesignerPageMode = 'intake' | 'progress';

export function DesignerPage({ mode }: { mode: DesignerPageMode }) {
  return mode === 'intake' ? <DesignerIntakeWorkflowV2 /> : <DesignerWorkflow mode={mode} />;
}
