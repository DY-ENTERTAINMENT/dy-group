import { DesignerWorkflow } from '../components/DesignerRequestWorkflow';

export type DesignerPageMode = 'intake' | 'progress';

export function DesignerPage({ mode }: { mode: DesignerPageMode }) {
  return <DesignerWorkflow mode={mode} />;
}
