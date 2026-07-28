'use client';

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu, MessageSquare, FileText, Globe, Plus } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brand } from './brand';
import { NewThreadButton } from './app-sidebar';
import { NavMain } from './nav-main';
import { NavAgents } from './nav-agents';
import { NavSecondary } from './nav-secondary';
import { NotificationsMenu } from './notifications-menu';
import { UserMenu } from './user-menu';
import { useLayout, type ViewMode } from './layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

export function MobileHeader() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { viewMode, setViewMode, openMobileList, openNewThread } = useLayout();
  const { workspace } = useWorkspace();

  // Close sheet when clicking a session
  useEffect(() => {
    if (isSheetOpen) {
      const handler = () => setIsSheetOpen(false);
      // Give the session click time to propagate
      const timeout = setTimeout(() => {
        document.addEventListener('session-selected', handler, { once: true });
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [isSheetOpen]);

  const handleViewSwitch = (mode: ViewMode) => {
    setViewMode(mode);
    openMobileList();
  };

  // Open the shared agent picker so the user chooses who joins the new session.
  const handleNewThread = () => openNewThread();

  const tabs: { mode: ViewMode; icon: typeof MessageSquare; label: string }[] = [
    { mode: 'threads', icon: MessageSquare, label: 'Threads' },
    { mode: 'files', icon: FileText, label: 'Files' },
    { mode: 'browser', icon: Globe, label: 'Browser' },
  ];

  return (
    <>
      <header className="fixed top-0 start-0 end-0 z-50 flex items-center shrink-0 bg-background/95 backdrop-blur-sm border-b h-[var(--header-height-mobile)]">
        <div className="grow flex items-center justify-between gap-2 px-3">
          {/* Left: menu + logo + workspace name */}
          <div className="flex items-center gap-2 min-w-0">
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" mode="icon" size="sm" className="shrink-0">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent className="p-0 gap-0 w-[280px] h-dvh bottom-auto pt-[calc(0.75rem+env(safe-area-inset-top))]" side="left" close={false}>
                <SheetHeader className="p-0 space-y-0">
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                </SheetHeader>
                <SheetBody className="grow flex flex-col min-h-0 p-0">
                  <SidebarProvider
                    open
                    onOpenChange={() => {}}
                    className="h-full min-h-0 flex-col"
                    style={{ '--sidebar-width': '280px' } as React.CSSProperties}
                  >
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="shrink-0 px-1 pt-1">
                        <Brand />
                        <NewThreadButton />
                      </div>
                      <ScrollArea className="min-h-0 flex-1">
                        <NavMain />
                        <NavAgents />
                      </ScrollArea>
                      <div className="shrink-0 border-t border-border px-1 pb-[env(safe-area-inset-bottom)]">
                        <NavSecondary />
                      </div>
                    </div>
                  </SidebarProvider>
                </SheetBody>
              </SheetContent>
            </Sheet>

            <div className="size-7 shrink-0">
              <Image src="/logo-black.png" alt="OpenAgents" width={28} height={28} className="size-full object-contain dark:hidden" />
              <Image src="/logo-white.png" alt="OpenAgents" width={28} height={28} className="size-full object-contain hidden dark:block" />
            </div>

            <span className="text-sm font-medium truncate">
              {workspace?.name || 'Workspace'}
            </span>
          </div>

          {/* Right: notifications, account and new thread */}
          <div className="flex items-center gap-0.5 shrink-0 text-muted-foreground">
            <NotificationsMenu />
            <UserMenu />
            <button
              onClick={handleNewThread}
              className="size-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0"
              title="New Thread"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Bottom navigation tabs */}
      <nav className="fixed bottom-0 start-0 end-0 z-50 bg-background/95 backdrop-blur-sm border-t safe-bottom">
        <div className="flex items-center justify-around h-12">
          {tabs.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => handleViewSwitch(mode)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                viewMode === mode
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )}
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
