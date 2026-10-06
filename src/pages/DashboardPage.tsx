import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SystemModal } from '../components/SystemModal';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { scheduleEventService } from '../services/schedule-event.service';
import { todoService } from '../services/todo.service';
import type { ScheduleEvent, TodoItem } from '../types/database';

type TodoFilter = 'open' | 'today' | 'overdue' | 'completed';
type TodoForm = { title: string; dueDate: string };
const emptyTodoForm: TodoForm = { title: '', dueDate: '' };

export function DashboardPage() {
  const navigate = useNavigate();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<ScheduleEvent[]>([]);
  const [filter, setFilter] = useState<TodoFilter>('open');
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [deletingTodo, setDeletingTodo] = useState<TodoItem | null>(null);
  const [menuTodoId, setMenuTodoId] = useState<string | null>(null);
  const [todoForm, setTodoForm] = useState<TodoForm>(emptyTodoForm);
  const [lastCompleted, setLastCompleted] = useState<TodoItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTodo, setSavingTodo] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void loadDashboard(); }, []);
  usePullToRefresh(loadDashboard);
  async function loadDashboard() {
    setLoading(true); setError('');
    try {
      await todoService.syncTodayRecurringTodos();
      const [todoList, eventList] = await Promise.all([todoService.getMyTodos(), scheduleEventService.getMyUpcomingScheduleEvents(7, 5)]);
      setTodos(todoList); setUpcomingEvents(eventList);
    } catch (loadError) { setError(getErrorMessage(loadError)); } finally { setLoading(false); }
  }
  const counts = useMemo(() => ({ open: todos.filter((todo) => !todo.is_completed).length, today: todos.filter((todo) => !todo.is_completed && todo.due_date === todayKey()).length, overdue: todos.filter((todo) => !todo.is_completed && todo.due_date && todo.due_date < todayKey()).length, completed: todos.filter((todo) => todo.is_completed).length }), [todos]);
  const visibleTodos = useMemo(() => todos.filter((todo) => filter === 'completed' ? todo.is_completed : !todo.is_completed && (filter === 'open' || filter === 'today' && todo.due_date === todayKey() || filter === 'overdue' && Boolean(todo.due_date && todo.due_date < todayKey()))), [filter, todos]);
  function openNewTodo() { setTodoForm(emptyTodoForm); setTodoModalOpen(true); }
  function openEditTodo(todo: TodoItem) { setTodoForm({ title: todo.title, dueDate: todo.due_date ?? '' }); setEditingTodo(todo); setMenuTodoId(null); }
  function setQuickDate(value: 'today' | 'tomorrow' | 'week') { const date = new Date(); if (value === 'tomorrow') date.setDate(date.getDate() + 1); if (value === 'week') date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7)); setTodoForm((current) => ({ ...current, dueDate: toDateKey(date) })); }
  async function handleSaveTodo(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const title = todoForm.title.trim(); if (!title) { setError('请输入工作内容。'); return; } setSavingTodo(true); setError(''); try { const saved = editingTodo ? await todoService.updateTodo(editingTodo.id, { title, due_date: todoForm.dueDate || null }) : await todoService.createTodo(title, todoForm.dueDate || null); setTodos((current) => editingTodo ? current.map((todo) => todo.id === saved.id ? saved : todo) : [...current, saved]); setTodoModalOpen(false); setEditingTodo(null); setTodoForm(emptyTodoForm); } catch (saveError) { setError(getErrorMessage(saveError)); } finally { setSavingTodo(false); } }
  async function handleCompleteTodo(todo: TodoItem) { setError(''); try { const completed = await todoService.completeTodo(todo.id); if (!completed) return; setTodos((current) => current.map((item) => item.id === completed.id ? completed : item)); setLastCompleted(completed); } catch (completeError) { setError(getErrorMessage(completeError)); } }
  async function handleReopenTodo(todo: TodoItem) { setError(''); try { const reopened = await todoService.reopenTodo(todo.id); setTodos((current) => current.map((item) => item.id === reopened.id ? reopened : item)); setLastCompleted((current) => current?.id === todo.id ? null : current); setMenuTodoId(null); } catch (reopenError) { setError(getErrorMessage(reopenError)); } }
  async function handleDeleteTodo() { if (!deletingTodo) return; setSavingTodo(true); setError(''); try { await todoService.deleteTodo(deletingTodo.id); setTodos((current) => current.filter((todo) => todo.id !== deletingTodo.id)); setLastCompleted((current) => current?.id === deletingTodo.id ? null : current); setDeletingTodo(null); } catch (deleteError) { setError(getErrorMessage(deleteError)); } finally { setSavingTodo(false); } }
  return <section className="home-page dashboard-workbench">
    {error ? <p className="form-alert">{error}</p> : null}
    <div className="dashboard-panel todo-panel"><div className="dashboard-panel-header"><h3>工作清单</h3><div className="dashboard-header-actions"><button className="icon-button dashboard-add-button" type="button" onClick={() => void loadDashboard()} aria-label="刷新工作清单"><RefreshCw size={18} /></button><button className="icon-button dashboard-add-button" type="button" onClick={openNewTodo} aria-label="新增工作"><Plus size={18} /></button></div></div>
      <div className="todo-filter-bar">{([{ id: 'open', label: '待办' }, { id: 'today', label: '今天' }, { id: 'overdue', label: '逾期' }, { id: 'completed', label: '已完成' }] as const).map((item) => <button className={filter === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => setFilter(item.id)}>{item.label} {counts[item.id]}</button>)}</div>
      {loading ? <div className="table-state compact-state">正在读取工作清单...</div> : visibleTodos.length === 0 ? <div className="dashboard-empty">暂无{filter === 'completed' ? '已完成记录' : '工作清单'}</div> : <div className="todo-list">{visibleTodos.map((todo) => <div className={`todo-item${todo.is_completed ? ' completed' : ''}`} key={todo.id}><input aria-label={`完成 ${todo.title}`} type="checkbox" checked={todo.is_completed} onChange={() => todo.is_completed ? void handleReopenTodo(todo) : void handleCompleteTodo(todo)} /><button className="todo-title-button" type="button" onClick={() => openEditTodo(todo)}>{todo.title}</button><button className={`todo-date${getTodoDateState(todo)}`} type="button" onClick={() => openEditTodo(todo)}>{todo.is_completed ? formatCompletedAt(todo.completed_at) : formatTodoDate(todo.due_date)}</button><div className="todo-menu-wrap"><button className="icon-button todo-more-button" type="button" aria-label={`${todo.title} 更多操作`} onClick={() => setMenuTodoId((current) => current === todo.id ? null : todo.id)}><MoreHorizontal size={18} /></button>{menuTodoId === todo.id ? <div className="todo-menu">{todo.is_completed ? <button type="button" onClick={() => void handleReopenTodo(todo)}>撤销完成</button> : null}<button type="button" onClick={() => openEditTodo(todo)}>编辑</button><button className="danger" type="button" onClick={() => { setDeletingTodo(todo); setMenuTodoId(null); }}>删除</button></div> : null}</div></div>)}</div>}
    </div>
    <div className="dashboard-panel upcoming-panel"><div className="dashboard-panel-header"><h3>近期行程</h3><CalendarDays size={19} /></div>{loading ? <div className="table-state compact-state">正在读取近期行程...</div> : upcomingEvents.length === 0 ? <div className="dashboard-empty">暂无近期行程</div> : <div className="upcoming-event-list">{upcomingEvents.map((event) => <button className="upcoming-event-item" type="button" key={event.id} onClick={() => navigate('/itinerary')}><span>{formatRelativeDate(event.event_date)}</span><strong>{formatEventTime(event)}{event.title}</strong></button>)}</div>}</div>
    {lastCompleted ? <div className="todo-toast">已完成：{lastCompleted.title}<button type="button" onClick={() => void handleReopenTodo(lastCompleted)}>撤销</button></div> : null}
    {(todoModalOpen || editingTodo) ? <SystemModal title={editingTodo ? '编辑工作' : '新增工作'} ariaLabel={editingTodo ? '编辑工作' : '新增工作'} wide={false} onClose={() => { setTodoModalOpen(false); setEditingTodo(null); }} footer={<><button className="secondary-button compact-button" type="button" onClick={() => { setTodoModalOpen(false); setEditingTodo(null); }} disabled={savingTodo}>取消</button><button className="primary-button compact-button" type="submit" form="dashboard-todo-form" disabled={savingTodo}>{savingTodo ? '保存中' : editingTodo ? '保存' : '新增工作'}</button></>}><form id="dashboard-todo-form" className="todo-form" onSubmit={handleSaveTodo}><label className="form-field"><span>工作内容</span><input value={todoForm.title} onChange={(event) => setTodoForm((current) => ({ ...current, title: event.target.value }))} autoFocus required /></label><div className="form-field"><span>日期提醒（选填）</span><div className="todo-date-options"><button type="button" onClick={() => setQuickDate('today')}>今天</button><button type="button" onClick={() => setQuickDate('tomorrow')}>明天</button><button type="button" onClick={() => setQuickDate('week')}>本周</button><input aria-label="选择日期" type="date" value={todoForm.dueDate} onChange={(event) => setTodoForm((current) => ({ ...current, dueDate: event.target.value }))} /></div></div></form></SystemModal> : null}
    {deletingTodo ? <SystemModal title="删除工作" ariaLabel="删除工作确认" wide={false} onClose={() => setDeletingTodo(null)} footer={<><button className="secondary-button compact-button" type="button" onClick={() => setDeletingTodo(null)} disabled={savingTodo}>取消</button><button className="primary-button compact-button danger-confirm-button" type="button" onClick={() => void handleDeleteTodo()} disabled={savingTodo}>确定删除</button></>}><p>确定删除「{deletingTodo.title}」吗？此操作无法恢复。</p></SystemModal> : null}
  </section>;
}
function todayKey() { return toDateKey(new Date()); }
function toDateKey(date: Date) { return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`; }
function getTodoDateState(todo: TodoItem) { if (todo.is_completed) return ' completed-date'; if (!todo.due_date) return ' empty'; if (todo.due_date < todayKey()) return ' overdue'; if (todo.due_date === todayKey()) return ' today'; return ''; }
function formatTodoDate(dueDate: string | null) { if (!dueDate) return ''; const diff = Math.round((new Date(`${dueDate}T00:00:00`).getTime() - startOfDay(new Date()).getTime()) / 86400000); if (diff === 0) return '今天'; if (diff === 1) return '明天'; if (diff < 0) return `逾期 ${Math.abs(diff)} 天`; return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' }).format(new Date(`${dueDate}T00:00:00`)); }
function formatCompletedAt(value: string | null) { return value ? `${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))} 完成` : '已完成'; }
function formatRelativeDate(date: string) { const diffDays = Math.round((startOfDay(new Date(`${date}T00:00:00`)).getTime() - startOfDay(new Date()).getTime()) / 86400000); if (diffDays === 0) return '今天'; if (diffDays === 1) return '明天'; return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00`)); }
function formatEventTime(event: ScheduleEvent) { return event.start_time ? `${event.start_time.slice(0, 5)} ` : ''; }
function startOfDay(date: Date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败。'; }
