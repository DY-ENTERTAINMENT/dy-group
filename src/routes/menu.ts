import type { LucideIcon } from 'lucide-react';
import {
  CalendarCheck2,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  FileClock,
  Home,
  MapPin,
  Palette,
  Route,
  Settings,
  Sparkles,
  UserRound,
  UsersRound,
} from 'lucide-react';

export type MenuItem = {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  section?: string;
  group?: string;
  disabled?: boolean;
};

export const menuItems: MenuItem[] = [
  {
    key: 'dashboard',
    label: '首页',
    path: '/dashboard',
    icon: Home,
  },
  {
    key: 'schedule',
    label: '休假日历',
    path: '/schedule',
    icon: CalendarDays,
  },
  {
    key: 'attendance',
    label: '打卡',
    path: '/attendance',
    icon: Clock3,
  },
  {
    key: 'leave',
    label: '请假',
    path: '/leave',
    icon: FileClock,
  },
  {
    key: 'itinerary',
    label: '行程表',
    path: '/itinerary',
    icon: Route,
  },
  {
    key: 'scout',
    label: '星探',
    path: '/tools/scout',
    icon: Sparkles,
    section: '工作工具',
    group: '星探',
    disabled: true,
  },
  {
    key: 'agent',
    label: '经纪人',
    path: '/tools/agent',
    icon: UserRound,
    section: '工作工具',
    group: '经纪人',
    disabled: true,
  },
  {
    key: 'designer',
    label: '美工',
    path: '/tools/designer',
    icon: Palette,
    section: '工作工具',
    group: '美工',
    disabled: true,
  },
  {
    key: 'staff',
    label: '工作人员',
    path: '/staff',
    icon: UsersRound,
    section: '工作工具',
    group: '人事部',
  },
  {
    key: 'registration-review',
    label: '注册审核',
    path: '/hr/registration-reviews',
    icon: ClipboardCheck,
    section: '工作工具',
    group: '人事部',
  },
  {
    key: 'leave-review',
    label: '请假审核',
    path: '/hr/leave-reviews',
    icon: FileClock,
    section: '工作工具',
    group: '人事部',
  },
  {
    key: 'attendance-management',
    label: '考勤',
    path: '/hr/attendance',
    icon: ClipboardCheck,
    section: '工作工具',
    group: '人事部',
  },
  {
    key: 'public-holidays',
    label: '公共假期',
    path: '/hr/public-holidays',
    icon: CalendarCheck2,
    section: '工作工具',
    group: '人事部',
  },
  {
    key: 'attendance-locations',
    label: '打卡地点',
    path: '/hr/attendance-locations',
    icon: MapPin,
    section: '工作工具',
    group: '人事部',
  },
  {
    key: 'settings',
    label: '系统设置',
    path: '/settings',
    icon: Settings,
    section: '工作工具',
    group: '管理',
  },
];

export const toolGroupOrder = ['星探', '经纪人', '美工', '人事部', '管理'];

export function getMenuPath(key: MenuItem['key']) {
  const item = menuItems.find((menuItem) => menuItem.key === key);

  if (!item) {
    throw new Error(`菜单配置不存在：${key}`);
  }

  return item.path.replace(/^\//, '');
}
