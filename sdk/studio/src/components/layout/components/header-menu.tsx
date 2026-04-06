import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useLayout } from './context';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { SidebarPrimary } from './sidebar-primary';
import { SidebarSecondary } from './sidebar-secondary';

export function HeaderMenu() {
  const { pathname } = useLocation();
  const { isMobile } = useLayout();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <div className="flex items-center">
      {/* Mobile sidebar toggle */}
      {isMobile && (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" mode="icon" size="sm">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent
            className="p-0 gap-0 w-[275px] lg:w-(--sidebar-width)"
            side="left"
            close={false}
          >
            <SheetHeader className="p-0 space-y-0" />
            <SheetBody className="flex grow p-0">
              <SidebarPrimary />
              <SidebarSecondary />
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}    
    </div>
  );
}
