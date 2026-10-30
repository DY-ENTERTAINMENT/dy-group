import { supabase } from '../lib/supabase';
import { designerRequestService, type DesignerReferenceAttachment, type DesignerStage, type DisplayEmployee, type DesignType, type TaskType, type WorkMode } from './designer-request.service';

export type DesignerManagementItem = { id: string; item_type: string; item_name: string | null; content: string | null; special_content: string | null; style: string | null; color: string | null; specification: string | null; sort_order: number };
export type DesignerManagementRequest = { id: string; creator_profile_id: string | null; request_type: DesignType; task_type: TaskType | null; other_design_type: string | null; work_mode: WorkMode | null; status: string; creator_name: string | null; platform_user_id: string | null; platform_account: string | null; event_start_at: string | null; event_end_at: string | null; design_content: string | null; special_content: string | null; style: string | null; color: string | null; specification: string | null; live_room: string | null; reference_material_status: 'not_required' | 'provided'; reference_note: string | null; reference_urls: string[]; design_urls: string[]; created_at: string; applicant: DisplayEmployee | null; creator: { manager: DisplayEmployee | null } | null; region: { name: string | null } | null; stages: DesignerStage[]; request_items: DesignerManagementItem[]; reference_attachments: DesignerReferenceAttachment[] };
type Snapshot = { requests?: DesignerManagementRequest[] };
const normalize = (request: DesignerManagementRequest): DesignerManagementRequest => ({ ...request, stages: request.stages ?? [], request_items: request.request_items ?? [], reference_attachments: request.reference_attachments ?? [], reference_urls: request.reference_urls ?? [], design_urls: request.design_urls ?? [] });

export const designerManagementService = {
  async listRequests() { const { data, error } = await supabase.rpc('list_management_designer_requests'); if (error) throw error; return ((data as Snapshot | null)?.requests ?? []).map(normalize); },
  getReferenceSignedUrl: designerRequestService.getReferenceSignedUrl,
  getReferenceDownloadSignedUrl: designerRequestService.getReferenceDownloadSignedUrl,
};
