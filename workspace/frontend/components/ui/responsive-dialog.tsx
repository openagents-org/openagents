'use client';

/**
 * Responsive dialog — renders a centered <Dialog> on desktop and a bottom
 * <Drawer> (with pull-down-to-close) on mobile. The exports are named to mirror
 * `@/components/ui/dialog` 1:1, so a component can opt in by changing only its
 * import path. Desktop appearance is delegated to the real Dialog primitives and
 * therefore stays byte-for-byte identical; only the mobile branch is new.
 */

import * as React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import * as D from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

const MobileContext = React.createContext(false);
const useResponsiveMobile = () => React.useContext(MobileContext);

function Dialog(props: React.ComponentProps<typeof D.Dialog>) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Drawer : D.Dialog;
  return (
    <MobileContext.Provider value={isMobile}>
      <Root {...props} />
    </MobileContext.Provider>
  );
}

function DialogTrigger(props: React.ComponentProps<typeof D.DialogTrigger>) {
  return useResponsiveMobile() ? <DrawerTrigger {...props} /> : <D.DialogTrigger {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof D.DialogClose>) {
  return useResponsiveMobile() ? <DrawerClose {...props} /> : <D.DialogClose {...props} />;
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof D.DialogContent>) {
  const isMobile = useResponsiveMobile();
  if (isMobile) {
    // The desktop-oriented className (fixed widths, max-h) is intentionally
    // dropped — the drawer manages its own sizing. DrawerContent is a flex
    // column, so <DialogHeader>/<DialogFooter> stay pinned and only the
    // <DialogBody> in between scrolls (mirroring the desktop dialog).
    return (
      <DrawerContent className="pb-[env(safe-area-inset-bottom)]">
        {children}
      </DrawerContent>
    );
  }
  return (
    <D.DialogContent className={className} {...props}>
      {children}
    </D.DialogContent>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useResponsiveMobile();
  if (isMobile) {
    return (
      <div
        data-slot="dialog-header"
        className={cn('flex shrink-0 flex-col gap-2 p-4 text-start', className)}
        {...props}
      />
    );
  }
  return <D.DialogHeader className={className} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useResponsiveMobile();
  if (isMobile) {
    return (
      <div
        data-slot="dialog-footer"
        className={cn('flex shrink-0 flex-row gap-2 border-t bg-muted/50 p-4 *:flex-1', className)}
        {...props}
      />
    );
  }
  return <D.DialogFooter className={className} {...props} />;
}

function DialogTitle(props: React.ComponentProps<typeof D.DialogTitle>) {
  return useResponsiveMobile() ? <DrawerTitle {...props} /> : <D.DialogTitle {...props} />;
}

function DialogDescription(props: React.ComponentProps<typeof D.DialogDescription>) {
  return useResponsiveMobile() ? (
    <DrawerDescription {...props} />
  ) : (
    <D.DialogDescription {...props} />
  );
}

function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useResponsiveMobile();
  if (isMobile) {
    return (
      <div
        data-slot="dialog-body"
        className={cn(
          'no-scrollbar min-h-0 grow overflow-y-auto overscroll-contain px-4 pb-4',
          className,
        )}
        {...props}
      />
    );
  }
  return <D.DialogBody className={className} {...props} />;
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
