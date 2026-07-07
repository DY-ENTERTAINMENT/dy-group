import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Menu } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { menuItems, toolGroupOrder } from '../routes/menu';
import logoUrl from '../assets/logo.png';
import { usePermissions } from '../hooks/usePermissions';

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
};

export function Sidebar({ collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  const permissions = usePermissions();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    工作工具: true,
  });
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    人事部: true,
    管理: true,
  });

  const visibleMenuItems = useMemo(
    () =>
      menuItems.filter((item) => {
        if (!item.section) return true;
        if (item.key === 'settings') return permissions.isSuperAdmin;
        return permissions.canView(item.key);
      }),
    [permissions],
  );
  const standaloneItems = visibleMenuItems.filter((item) => !item.section);
  const groupedSections = useMemo(
    () =>
      visibleMenuItems.reduce<Record<string, Record<string, typeof menuItems>>>((sections, item) => {
        if (!item.section) {
          return sections;
        }

        const groupName = item.group ?? '其他';
        sections[item.section] = sections[item.section] ?? {};
        sections[item.section][groupName] = sections[item.section][groupName] ?? [];
        sections[item.section][groupName].push(item);

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

        {Object.entries(groupedSections).map(([sectionName, groups]) => {
          const sectionExpanded = expandedSections[sectionName] ?? false;
          const sortedGroups = Object.entries(groups).sort(
            ([groupA], [groupB]) => toolGroupOrder.indexOf(groupA) - toolGroupOrder.indexOf(groupB),
          );

          return (
            <div className="nav-section" key={sectionName}>
              <button
                className="nav-toggle"
                type="button"
                title={collapsed ? sectionName : undefined}
                onClick={() => toggleSection(sectionName)}
              >
                {sectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span>{sectionName}</span>
              </button>

              {sectionExpanded ? (
                <div className="nav-section-body">
                  {sortedGroups.map(([groupName, items]) => {
                    const groupExpanded = expandedGroups[groupName] ?? false;
                    const onlyDisabledPlaceholder = items.every((item) => item.disabled);

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
                          {groupExpanded && !onlyDisabledPlaceholder ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
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
        <Icon size={18} />
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
      <Icon size={18} />
      <span>{item.label}</span>
    </NavLink>
  );
}
