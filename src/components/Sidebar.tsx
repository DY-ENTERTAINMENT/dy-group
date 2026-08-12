import { useMemo, useState } from 'react';
import {
  Briefcase,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Menu,
  Paintbrush,
  Shield,
  UserSearch,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { menuItems, toolGroupOrder } from '../routes/menu';
import logoUrl from '../assets/logo.png';
import { usePermissions } from '../hooks/usePermissions';

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
};

const sectionIcons: Record<string, LucideIcon> = {
  工作工具: BriefcaseBusiness,
  管理: Shield,
};

const groupIcons: Record<string, LucideIcon> = {
  星探: UserSearch,
  经纪人: Briefcase,
  美工: Paintbrush,
  人事部: Users,
};

export function Sidebar({ collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  const permissions = usePermissions();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const visibleMenuItems = useMemo(
    () =>
      menuItems.filter((item) => {
        if (item.regionFeaturePermissionKey) {
          return permissions.hasRegionFeaturePermission(item.regionFeaturePermissionKey, 'view');
        }
        if (!item.section) return true;
        if (item.key === 'settings') return permissions.isSuperAdmin;
        return permissions.canView(item.key);
      }),
    [permissions],
  );
  const standaloneItems = visibleMenuItems.filter((item) => !item.section);
  const groupedSections = useMemo(
    () =>
      visibleMenuItems.reduce<Record<string, { items: typeof menuItems; groups: Record<string, typeof menuItems> }>>((sections, item) => {
        if (!item.section) {
          return sections;
        }

        sections[item.section] = sections[item.section] ?? { items: [], groups: {} };

        if (!item.group) {
          sections[item.section].items.push(item);
          return sections;
        }

        sections[item.section].groups[item.group] = sections[item.section].groups[item.group] ?? [];
        sections[item.section].groups[item.group].push(item);

        return sections;
      }, {}),
    [visibleMenuItems],
  );

  function toggleSection(sectionName: string) {
    setExpandedSections((current) => ({
      ...current,
      [sectionName]: !current[sectionName],
    }));
  }

  function toggleGroup(groupName: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupName]: !current[groupName],
    }));
  }

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="brand">
        <button className="sidebar-collapse-button" type="button" onClick={onToggleCollapsed} aria-label="收起菜单">
          <Menu size={20} />
        </button>
        <img className="brand-logo" src={logoUrl} alt="DY Group" title="DY Group" />
      </div>

      <nav className="nav" aria-label="主菜单">
        {standaloneItems.map((item) => (
          <SidebarLink key={item.path} item={item} collapsed={collapsed} nested={false} onNavigate={onNavigate} />
        ))}

        {Object.entries(groupedSections).map(([sectionName, section]) => {
          const sectionExpanded = expandedSections[sectionName] ?? false;
          const SectionIcon = sectionIcons[sectionName];
          const sectionDisplayName = getSectionDisplayName(sectionName);
          const flattenedGroupItems = section.groups[sectionName] ?? [];
          const sortedGroups = Object.entries(section.groups).sort(([groupA], [groupB]) => getGroupOrder(groupA) - getGroupOrder(groupB));

          return (
            <div className="nav-section" key={sectionName}>
              <button
                className="nav-toggle"
                type="button"
                title={collapsed ? sectionDisplayName : undefined}
                onClick={() => toggleSection(sectionName)}
              >
                <span className="nav-chevron">{sectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                {SectionIcon ? <SectionIcon className="nav-menu-icon" size={20} /> : null}
                <span>{sectionDisplayName}</span>
              </button>

              {sectionExpanded ? (
                <div className="nav-section-body">
                  {[...section.items, ...flattenedGroupItems].map((item) => (
                    <SidebarLink key={item.path} item={item} collapsed={collapsed} nested onNavigate={onNavigate} />
                  ))}

                  {sortedGroups.map(([groupName, items]) => {
                    if (groupName === sectionName) return null;

                    const groupExpanded = expandedGroups[groupName] ?? false;
                    const onlyDisabledPlaceholder = items.every((item) => item.disabled);
                    const GroupIcon = groupIcons[groupName];

                    return (
                      <div className="nav-group" key={groupName}>
                        <button
                          className={onlyDisabledPlaceholder ? 'nav-group-toggle muted' : 'nav-group-toggle'}
                          type="button"
                          title={collapsed ? groupName : undefined}
                          onClick={() => {
                            if (!onlyDisabledPlaceholder) {
                              toggleGroup(groupName);
                            }
                          }}
                          disabled={onlyDisabledPlaceholder}
                        >
                          <span className="nav-chevron">
                            {groupExpanded && !onlyDisabledPlaceholder ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </span>
                          {GroupIcon ? <GroupIcon className="nav-menu-icon" size={18} /> : null}
                          <span>{groupName}</span>
                        </button>

                        {groupExpanded && !onlyDisabledPlaceholder ? (
                          <div className="nav-group-body">
                            {items.map((item) => (
                              <SidebarLink key={item.path} item={item} collapsed={collapsed} nested onNavigate={onNavigate} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function getGroupOrder(groupName: string) {
  const order = toolGroupOrder.indexOf(groupName);
  return order === -1 ? Number.MAX_SAFE_INTEGER : order;
}

function getSectionDisplayName(sectionName: string) {
  return sectionName;
}

function SidebarLink({
  item,
  collapsed,
  nested,
  onNavigate,
}: {
  item: (typeof menuItems)[number];
  collapsed: boolean;
  nested: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <span className={nested ? 'nav-link nested muted' : 'nav-link muted'} title={collapsed ? item.label : undefined}>
        <Icon size={nested ? 18 : 20} />
        <span>{item.label}</span>
      </span>
    );
  }

  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) => {
        const baseClass = nested ? 'nav-link nested' : 'nav-link';
        return isActive ? `${baseClass} active` : baseClass;
      }}
    >
      <Icon size={nested ? 18 : 20} />
      <span>{item.label}</span>
    </NavLink>
  );
}

