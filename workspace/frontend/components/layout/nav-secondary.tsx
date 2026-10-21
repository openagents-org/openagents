'use client';

import { useFirstDeviceGuide } from '@/hooks/use-first-device-guide';
import { FirstDeviceHint, SETUP_STEP_BUTTON } from './first-device-hint';
import { PlusSquare } from 'lucide-react';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { useLayout } from './layout-context';

/**
 * Pinned footer nav. When the workspace has no agent yet this becomes the
 * primary call to action, mirroring the previous sidebar behaviour.
 */
export function NavSecondary({ onNavigate }: { onNavigate?: () => void }) {
  const { viewMode, openView } = useLayout();
  const { agents } = useWorkspace();
  const t = useT();
  const hasAgents = agents.filter((a) => isRecentAgent(a) && !a.builtin).length > 0;
  const isActive = viewMode === 'connect';
  const setupStep = useFirstDeviceGuide();
  const showSetupHint = !!setupStep && !isActive;
  const connectLabel = setupStep === 'device' ? t('nav.connectFirstDevice') : hasAgents ? t('nav.connectAgent') : t('nav.connectFirstAgent');

  return (
    <SidebarGroup className="py-1">
      {showSetupHint && setupStep && <FirstDeviceHint step={setupStep} />}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={connectLabel}
            isActive={isActive}
            onClick={() => {
              openView('connect');
              onNavigate?.();
            }}
            className={cn(
              showSetupHint && SETUP_STEP_BUTTON,
              !hasAgents && !showSetupHint &&
                !isActive &&
                'bg-primary/10 text-primary font-medium hover:bg-primary/20 hover:text-primary',
              !hasAgents && isActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            )}
          >
            <PlusSquare />
            <span>{connectLabel}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
