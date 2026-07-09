import type { LucideIcon } from 'lucide-react';
import {
  Brush,
  CalendarCheck2,
  CalendarDays,
  ClipboardList,
  ClipboardCheck,
  Clock3,
  BarChart3,
  Database,
  FileClock,
  Home,
  ListChecks,
  MapPin,
  Palette,
  Route,
  Settings,
  Sparkles,
  UserCheck,
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
    key: 'scout-recruiting-data',
    label: '招募数据',
    path: '/tools/scout/recruiting-data',
    icon: Sparkles,
    section: '工作工具',
    group: '星探',
  },
  {
    key: 'scout-recruit-list',
    label: '名单',
    path: '/tools/scout/recruit-list',
    icon: ListChecks,
    section: '工作工具',
    group: '星探',
  },
  {
    key: 'scout-onboarding',
    label: '入公会',
    path: '/tools/scout/onboarding',
    icon: UserCheck,
    section: '工作工具',
    group: '星探',
  },
  {
    key: 'scout-streamer-stats',
    label: '主播统计',
    path: '/tools/scout/streamer-stats',
    icon: Database,
    section: '工作工具',
    group: '星探',
  },
  {
    key: 'agent-revenue-data',
    label: '流水数据',
    path: '/tools/agent/revenue-data',
    icon: BarChart3,
    section: '工作工具',
    group: '经纪人',
  },
  {
    key: 'agent-creator-data',
    label: '主播数据',
    path: '/tools/agent/creator-data',
    icon: Database,
    section: '工作工具',
    group: '经纪人',
  },
  {
    key: 'agent-adjustment-requests',
    label: '主播资料调整申请',
    path: '/tools/agent/adjustment-requests',
    icon: ClipboardList,
    section: '工作工具',
    group: '经纪人',
  },
  {
    key: 'agent-design-requests',
    label: '美工申请',
    path: '/tools/agent/design-requests',
    icon: Brush,
    section: '工作工具',
    group: '经纪人',
  },
  {
    key: 'designer-intake',
    label: '接单',
    path: '/tools/designer/intake',
    icon: Brush,
    section: '工作工具',
    group: '美工',
  },
  {
    key: 'designer-progress',
    label: '进度',
    path: '/tools/designer/progress',
    icon: ClipboardList,
    section: '工作工具',
    group: '美工',
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
    key: 'management-revenue-data',
    label: '总流水数据',
    path: '/management/revenue-data',
    icon: BarChart3,
    section: '管理',
    group: '管理',
  },
  {
    key: 'management-streamer-stats',
    label: '总主播统计',
    path: '/management/streamer-stats',
    icon: Database,
    section: '管理',
    group: '管理',
  },
  {
    key: 'management-recruiting-data',
    label: '总招募数据',
    path: '/management/recruiting-data',
    icon: Sparkles,
    section: '管理',
    group: '管理',
  },
  {
    key: 'settings',
    label: '系统设置',
    path: '/settings',
    icon: Settings,
    section: '管理',
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


