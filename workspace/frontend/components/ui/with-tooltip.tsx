'use client';

import { useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    // Environments without :focus-visible support keep the default behaviour.
    return true;
  }
}

/**
 * Passes the trigger's props through to the wrapped element, minus the
 * tooltip's own `data-state`. Without this the tooltip's "closed" would
 * overwrite the element's state attribute — a ToggleGroupItem lost its "on"
 * highlight and a menu trigger its "open" style.
 */
function WithoutTooltipState({ 'data-state': _tooltipState, ...props }: ComponentProps<typeof Slot.Root> & { 'data-state'?: string }) {
  return <Slot.Root {...props} />;
}

/**
 * Wraps one focusable element in a Tooltip — the replacement for a native
 * `title=` hint. Renders the child unchanged when there is no label.
 *
 * Menus and popovers hand focus back to their trigger when they close; a
 * plain Tooltip opens on that focus and pops up right after the user picked
 * something. So focus only opens it when it is keyboard focus
 * (:focus-visible); hover works as usual.
 */
export function WithTooltip({ label, side, children }: {
  label?: ReactNode;
  side?: ComponentProps<typeof TooltipContent>['side'];
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const pointerFocus = useRef(false);
  if (!label) return children;
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (next && pointerFocus.current) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        asChild
        onFocus={(event) => { pointerFocus.current = !isKeyboardFocus(event.currentTarget); }}
        onBlur={() => { pointerFocus.current = false; }}
        onPointerMove={() => { pointerFocus.current = false; }}
      >
        <WithoutTooltipState>{children}</WithoutTooltipState>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
