'use client';

import type { ComponentType } from 'react';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useT } from '@/lib/i18n';

export type AuthChoice = 'subscription' | 'key' | 'later';

export interface AuthOption {
  id: AuthChoice;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

/** How the new agent authenticates, as choice cards: the whole card picks it. */
export function AgentSetupAuthChoice({ options, value, disabled, onChange }: {
  options: AuthOption[];
  value: AuthChoice | null;
  disabled?: boolean;
  onChange: (next: AuthChoice) => void;
}) {
  const t = useT();
  return (
    <RadioGroup
      aria-label={t('agentSetup.authentication')}
      value={value ?? ''}
      onValueChange={(next) => onChange(next as AuthChoice)}
      disabled={disabled}
    >
      {options.map(({ id, icon: Icon, title, description }) => (
        <FieldLabel key={id} htmlFor={`agent-setup-auth-${id}`}>
          <Field orientation="horizontal">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <FieldContent>
              <FieldTitle>{title}</FieldTitle>
              <FieldDescription>{description}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={id} id={`agent-setup-auth-${id}`} data-testid={`agent-setup-auth-${id}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  );
}
