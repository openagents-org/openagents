'use client';
import { useOnboardingSurface } from './onboarding-surface';

import { useFirstDeviceGuide } from '@/hooks/use-first-device-guide';
import { FirstDeviceHint } from './first-device-hint';
import { ConnectAgentButton } from './connect-agent-button';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
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
  const onboarding = useOnboardingSurface();
  const isActive = onboarding || viewMode === 'connect';
  const setupStep = useFirstDeviceGuide();
  const showSetupHint = !!setupStep && !isActive;
  const connectLabel = onboarding || setupStep === 'device' || hasAgents ? t('nav.connectAgent') : t('nav.connectFirstAgent');

  return (
    <SidebarGroup className="py-1">
      {showSetupHint && setupStep && <FirstDeviceHint step={setupStep} />}
      <SidebarMenu>
        <SidebarMenuItem>
          <ConnectAgentButton
            label={connectLabel}
            active={isActive}
            onClick={() => {
              openView('connect');
              onNavigate?.();
            }}
          />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
