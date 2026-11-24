import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { scheduleEventService } from '../services/schedule-event.service';
import type { ScheduleEvent } from '../types/database';
import { WorkListV2 } from '../components/WorkListV2';
import './WorkListV2.css';

export function DashboardPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function loadEvents() { setLoading(true); try { setEvents(await scheduleEventService.getMyUpcomingScheduleEvents(7, 5)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '读取行程失败'); } finally { setLoading(false); } }
  useEffect(() => { void loadEvents(); }, []);
  usePullToRefresh(loadEvents);
  return <section className="home-page dashboard-workbench work-v2-layout">
    <WorkListV2 />
    <div className="dashboard-panel upcoming-panel"><div className="dashboard-panel-header"><h3>近期行程</h3><CalendarDays size={19} /></div>{error ? <p className="form-alert">{error}</p> : loading ? <div className="table-state compact-state">正在读取近期行程...</div> : events.length === 0 ? <div className="dashboard-empty">暂无近期行程</div> : <div className="upcoming-event-list">{events.map(event => <button className="upcoming-event-item" type="button" key={event.id} onClick={() => navigate('/itinerary')}><span>{formatRelativeDate(event.event_date)}</span><strong>{event.start_time ? `${event.start_time.slice(0, 5)} ` : ''}{event.title}</strong></button>)}</div>}</div>
  </section>;
}
function formatRelativeDate(date: string) { const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); const diff = Math.round((start(new Date(`${date}T00:00:00`)) - start(new Date())) / 86400000); return diff === 0 ? '今天' : diff === 1 ? '明天' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00`)); }
