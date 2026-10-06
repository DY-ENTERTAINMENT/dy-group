import { supabase } from '../lib/supabase';
import type { RecurringTodoFrequency, RecurringTodoItem, TodoItem } from '../types/database';

export type RecurringTodoPayload = {
  title: string;
  frequency: RecurringTodoFrequency;
  weekly_days?: number[];
  monthly_day?: number | null;
};

export const recurringTodoFrequencyLabels: Record<RecurringTodoFrequency, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  month_end: '每月最后一天',
  custom: '自定义',
};

export const todoService = {
  async getMyTodos() {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('todo_items')
      .select('*')
      .eq('profile_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as TodoItem[];
  },

  async getMyOpenTodos() {
    const todos = await this.getMyTodos();
    return todos.filter((todo) => !todo.is_completed);
  },

  async syncTodayRecurringTodos() {
    const userId = await getCurrentUserId();
    const today = new Date();
    const dueDate = toDateKey(today);
    const recurringItems = await this.getMyRecurringTodos();
    const dueItems = recurringItems.filter((item) => isRecurringTodoDue(item, today));

    if (dueItems.length === 0) {
      return;
    }

    const dueIds = dueItems.map((item) => item.id);
    const { data: existing, error: existingError } = await supabase
      .from('todo_items')
      .select('recurring_todo_id')
      .eq('profile_id', userId)
      .eq('due_date', dueDate)
      .in('recurring_todo_id', dueIds);

    if (existingError) {
      throw existingError;
    }

    const existingIds = new Set((existing ?? []).map((item) => item.recurring_todo_id).filter(Boolean));
    const missingItems = dueItems.filter((item) => !existingIds.has(item.id));

    if (missingItems.length === 0) {
      return;
    }

    const payload = missingItems.map((item) => ({
      profile_id: userId,
      recurring_todo_id: item.id,
      title: item.title,
      due_date: dueDate,
    }));

    const { error } = await supabase.from('todo_items').insert(payload);

    if (error) {
      throw error;
    }
  },

  async createTodo(title: string, dueDate: string | null = null) {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('todo_items')
      .insert({
        profile_id: userId,
        title: title.trim(),
        due_date: dueDate,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return data as TodoItem;
  },

  async completeTodo(id: string) {
    const { data, error } = await supabase
      .from('todo_items')
      .update({
        is_completed: true,
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return data as TodoItem | null;
  },

  async reopenTodo(id: string) {
    const { data, error } = await supabase
      .from('todo_items')
      .update({ is_completed: false, completed_at: null })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data as TodoItem;
  },

  async updateTodo(id: string, values: Pick<TodoItem, 'title' | 'due_date'>) {
    const { data, error } = await supabase
      .from('todo_items')
      .update({ title: values.title.trim(), due_date: values.due_date })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data as TodoItem;
  },

  async deleteTodo(id: string) {
    const { error } = await supabase.from('todo_items').delete().eq('id', id);
    if (error) throw error;
  },

  async getMyRecurringTodos() {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('recurring_todo_items')
      .select('*')
      .eq('profile_id', userId)
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    return sortRecurringTodos((data ?? []) as RecurringTodoItem[]);
  },

  async createRecurringTodo(values: RecurringTodoPayload) {
    const userId = await getCurrentUserId();
    const normalized = normalizeRecurringTodoPayload(values);
    const { data, error } = await supabase
      .from('recurring_todo_items')
      .insert({
        profile_id: userId,
        ...normalized,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return data as RecurringTodoItem;
  },

  async deleteRecurringTodo(id: string) {
    const { error } = await supabase.from('recurring_todo_items').delete().eq('id', id);

    if (error) {
      throw error;
    }
  },
};

export function getRecurringTodoRuleLabel(item: Pick<RecurringTodoItem, 'frequency' | 'weekly_days' | 'monthly_day'>) {
  if (item.frequency === 'weekly') {
    const days = item.weekly_days.length ? item.weekly_days : [1];
    return `每周${days.map((day) => weekdayNames[day] ?? '').join('、')}`;
  }

  if (item.frequency === 'monthly') {
    return `每月${item.monthly_day ?? 1}号`;
  }

  return recurringTodoFrequencyLabels[item.frequency];
}

function normalizeRecurringTodoPayload(values: RecurringTodoPayload) {
  const title = values.title.trim();

  if (!title) {
    throw new Error('请输入任务名称。');
  }

  if (values.frequency === 'weekly') {
    return {
      title,
      frequency: values.frequency,
      weekly_days: values.weekly_days?.length ? values.weekly_days : [1],
      monthly_day: null,
    };
  }

  if (values.frequency === 'monthly') {
    const monthlyDay = values.monthly_day ?? 1;
    if (monthlyDay < 1 || monthlyDay > 31) {
      throw new Error('每月日期必须介于 1 到 31。');
    }

    return {
      title,
      frequency: values.frequency,
      weekly_days: [],
      monthly_day: monthlyDay,
    };
  }

  return {
    title,
    frequency: values.frequency,
    weekly_days: [],
    monthly_day: null,
  };
}

function isRecurringTodoDue(item: RecurringTodoItem, date: Date) {
  const weekday = date.getDay();
  const day = date.getDate();

  if (item.frequency === 'daily') return true;
  if (item.frequency === 'weekly') return item.weekly_days.includes(weekday);
  if (item.frequency === 'monthly') return item.monthly_day === day;
  if (item.frequency === 'month_end') return day === getLastDayOfMonth(date);

  return false;
}

function sortRecurringTodos(items: RecurringTodoItem[]) {
  return [...items].sort((first, second) => {
    const firstOrder = getRecurringSortOrder(first);
    const secondOrder = getRecurringSortOrder(second);
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    return first.created_at.localeCompare(second.created_at);
  });
}

function getRecurringSortOrder(item: RecurringTodoItem) {
  if (item.frequency === 'daily') return 0;
  if (item.frequency === 'weekly') return 10 + Math.min(...(item.weekly_days.length ? item.weekly_days : [1]));
  if (item.frequency === 'monthly') return 40 + (item.monthly_day ?? 1);
  if (item.frequency === 'month_end') return 80;
  return 90;
}

function getLastDayOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  const userId = data.user?.id;

  if (!userId) {
    throw new Error('请先登录后再管理工作清单。');
  }

  return userId;
}

const weekdayNames: Record<number, string> = {
  0: '日',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
};
