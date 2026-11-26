import type { ItineraryValues } from './itinerary-v2.service';

// Date-only and partial-time entries are allowed for compatibility with the
// original personal calendar. All-day saves ignore hidden clock inputs.
export function validateItineraryValues(values: ItineraryValues): void {
  if (!values.title.trim()) throw new Error('请填写行程名称。');
  if (!values.event_date || !values.end_date || values.end_date < values.event_date) {
    throw new Error('结束日期不能早于开始日期。');
  }
  if (!values.is_all_day && values.start_time && values.end_time &&
      values.event_date === values.end_date && values.end_time <= values.start_time) {
    throw new Error('结束时间必须晚于开始时间。');
  }
}
