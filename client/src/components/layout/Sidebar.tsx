import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { getNavGroups, type NavItem } from './navConfig';

const SIDEBAR_WIDTH_OPEN = 'lg:w-[268px]';
const SIDEBAR_WIDTH_CLOSED = 'lg:w-[68px]';

interface SidebarProps {
  isOpen: boolean;
  onNavigate: () => void;
  onDismiss: () => void;
}

function NavItemLink({
  item,
  isActive,
  isOpen,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  isOpen: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        to={item.href}
        title={isOpen ? undefined : item.label}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
          isActive
            ? 'bg-primary-light text-primary'
            : 'text-text-muted hover:bg-background hover:text-text'
        } ${isOpen ? '' : 'justify-center px-2'}`}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span
          className={`min-w-0 overflow-hidden whitespace-nowrap transition-[width,opacity] duration-200 ${
            isOpen ? 'flex-1 opacity-100' : 'w-0 flex-none opacity-0'
          }`}
        >
          {item.label}
        </span>
      </Link>
    </li>
  );
}

export function Sidebar({ isOpen, onNavigate, onDismiss }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const groups = getNavGroups(isAdmin);

  return (
    <>
      {isOpen && (
        <div
          data-testid="sidebar-backdrop"
          aria-hidden="true"
          onClick={onDismiss}
          className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 lg:hidden"
        />
      )}
      <aside
        id="app-sidebar"
        data-testid="app-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col overflow-hidden border-r border-border bg-surface transition-[transform,width,visibility] duration-200 ease-in-out ${
          isOpen
            ? `translate-x-0 ${SIDEBAR_WIDTH_OPEN}`
            : `-translate-x-full invisible lg:visible lg:translate-x-0 ${SIDEBAR_WIDTH_CLOSED}`
        }`}
      >
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-6">
            {groups.map((group) => (
              <li key={group.id}>
                <span
                  className={`block px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-text-muted ${
                    isOpen ? '' : 'lg:hidden'
                  }`}
                >
                  {group.label}
                </span>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <NavItemLink
                      key={item.href}
                      item={item}
                      isActive={location.pathname === item.href}
                      isOpen={isOpen}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
