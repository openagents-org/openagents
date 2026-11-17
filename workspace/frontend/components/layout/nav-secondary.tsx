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
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { useLayout } from './layout-context';

/**
 * Manage Agents at the top of the mobile drawer, under the brand. When the
 * workspace has no agent yet it is the call to action to connect one.
 */
export function NavSecondary({ onNavigate }: { onNavigate?: () => void }) {
  const { viewMode, openView } = useLayout();
  const { agents } = useWorkspace();
  const t = useT();
  const hasConnectedAgents = agents.some((a) => !a.builtin);
  const onboarding = useOnboardingSurface();
  const isActive = onboarding || viewMode === 'connect';
  const setupStep = useFirstDeviceGuide();
  const showSetupHint = !!setupStep && !isActive;
  const connectLabel = hasConnectedAgents ? t('nav.manageAgents') : t('nav.connectAgent');

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
