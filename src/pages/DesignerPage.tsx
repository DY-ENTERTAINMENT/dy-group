import { DesignerIntakeWorkflowV2, DesignerWorkflow } from '../components/DesignerRequestWorkflow';
import { DesignerProgressWorkspaceV2 } from '../components/DesignerProgressWorkspaceV2';

export type DesignerPageMode = 'intake' | 'progress';

export function DesignerPage({ mode }: { mode: DesignerPageMode }) {
  return mode === 'intake' ? <DesignerIntakeWorkflowV2 /> : <DesignerProgressWorkspaceV2 />;
}
