import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export const SIDEBAR_STORAGE_KEY = 'wealthhabit.sidebar.open';

const DESKTOP_MIN_WIDTH = 1024;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < DESKTOP_MIN_WIDTH;
}

function readStoredSidebarOpen(): boolean {
  try {
    const value = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  } catch {
    // Storage can be unavailable (private mode / blocked cookies).
  }
  return false;
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  // Desktop: sidebar participates in the layout (compact vs expanded).
  // On mobile the drawer is always closed on load; the stored preference
  // only describes the desktop layout.
  const [isExpanded, setIsExpanded] = useState<boolean>(() =>
    isMobileViewport() ? false : readStoredSidebarOpen()
  );
  // Mobile: sidebar renders as an overlay drawer.
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const isSidebarOpen = isExpanded || isDrawerOpen;

  useEffect(() => {
    if (isMobileViewport()) {
      return;
    }
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isExpanded));
    } catch {
      // Ignore storage write failures; the sidebar still works in memory.
    }
  }, [isExpanded]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
        setIsDrawerOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDrawerOpen]);

  const toggleSidebar = useCallback(() => {
    if (isMobileViewport()) {
      setIsDrawerOpen((open) => !open);
    } else {
      setIsExpanded((open) => !open);
      setIsDrawerOpen(false);
    }
  }, []);

  const closeSidebar = useCallback(() => {
    setIsExpanded(false);
    setIsDrawerOpen(false);
  }, []);

  const closeDrawerOnNavigate = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        isOpen={isSidebarOpen}
        onNavigate={closeDrawerOnNavigate}
        onDismiss={closeSidebar}
      />
      <div
        className={`transition-[padding] duration-200 ease-in-out ${
          isSidebarOpen ? 'lg:pl-[268px]' : 'lg:pl-[68px]'
        }`}
      >
        <Header isSidebarOpen={isSidebarOpen} onToggleSidebar={toggleSidebar} />
        {children}
      </div>
    </div>
  );
}
