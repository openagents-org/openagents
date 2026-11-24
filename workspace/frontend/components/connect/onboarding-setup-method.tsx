'use client';

import { useId } from 'react';
import { Bot, Laptop, Terminal } from 'lucide-react';
import type { DeviceSetupMethod } from '@/components/layout/layout-context';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useT } from '@/lib/i18n';

const METHODS = [
  { id: 'terminal', icon: Terminal, label: 'onboarding.terminalServer', hint: 'onboarding.commandLineTarget', platforms: [{ icon: 'windows', label: 'Windows' }, { icon: 'apple', label: 'macOS' }, { icon: 'linux', label: 'Linux' }] },
  { id: 'desktop', icon: Laptop, label: 'onboarding.desktopApp', hint: 'onboarding.desktopAppTarget', platforms: [{ icon: 'windows', label: 'Windows' }, { icon: 'apple', label: 'macOS' }] },
  { id: 'agent', icon: Bot, label: 'connect.agentJoinTitle', hint: 'connect.agentJoinTarget', platforms: [{ icon: 'agents/claude', label: 'Claude Code' }, { icon: 'agents/codex', label: 'Codex' }, { icon: 'agents/opencode', label: 'OpenCode' }] },
] as const;

/** How the computer gets connected, as choice cards: the whole card picks it. */
export function OnboardingSetupMethod({ value, onChange }: {
  value: DeviceSetupMethod;
  onChange: (method: DeviceSetupMethod) => void;
}) {
  const t = useT();
  // Per instance: a cached, hidden panel keeps its own cards mounted, and a
  // label's htmlFor reaches the first matching id in the document.
  const base = useId();
  return (
    <RadioGroup className="mt-5" aria-label={t('onboarding.setupMethod')} value={value} onValueChange={(next) => onChange(next as DeviceSetupMethod)}>
      {METHODS.map(({ id, icon: Icon, label, hint, platforms }) => (
        <FieldLabel key={id} htmlFor={`${base}-${id}`}>
          <Field orientation="horizontal">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <FieldContent>
              <FieldTitle>{t(label)}</FieldTitle>
              <FieldDescription>{t(hint)}</FieldDescription>
            </FieldContent>
            <span className="hidden shrink-0 items-center gap-2.5 sm:flex" aria-hidden="true">
              {platforms.map((platform) => (
                <img key={platform.icon} src={platform.icon.startsWith('agents/') ? `/icons/${platform.icon}.svg` : `/icons/platforms/${platform.icon}.svg`}
                  alt="" title={platform.label} width={14} height={14}
                  className="size-3.5 object-contain opacity-60 dark:invert" />
              ))}
            </span>
            <RadioGroupItem value={id} id={`${base}-${id}`} data-testid={`setup-method-${id}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  );
}
