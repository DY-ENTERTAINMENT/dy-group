import { supabase } from '../lib/supabase';

export type DesignerReferencePricing = {
  banner_production_price: number;
  standee_production_price: number;
  event_design_setup_price: number;
  updated_at: string;
  updated_by: string | null;
};

export type UpdateDesignerReferencePricing = Pick<
  DesignerReferencePricing,
  'banner_production_price' | 'standee_production_price' | 'event_design_setup_price'
>;

// The generated database types intentionally do not include the local-only
// Phase 1 migration yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const designerPricingService = {
  async getReferencePricing(): Promise<DesignerReferencePricing> {
    const { data, error } = await db
      .from('designer_reference_pricing')
      .select('banner_production_price, standee_production_price, event_design_setup_price, updated_at, updated_by')
      .eq('singleton', true)
      .single();

    if (error) throw error;
    return data as DesignerReferencePricing;
  },

  async updateReferencePricing(input: UpdateDesignerReferencePricing): Promise<DesignerReferencePricing> {
    const { data, error } = await db.rpc('update_designer_reference_pricing', {
      p_banner_production_price: input.banner_production_price,
      p_standee_production_price: input.standee_production_price,
      p_event_design_setup_price: input.event_design_setup_price,
    });

    if (error) throw error;
    return data as DesignerReferencePricing;
  },
};
