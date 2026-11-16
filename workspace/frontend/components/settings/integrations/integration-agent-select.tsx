'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';

/**
 * "No default agent", as a value a Select can hold.
 *
 * Radix refuses an empty string for an item — it reserves it for "nothing is
 * selected" — so the absence has to travel under a name of its own and be
 * turned back into '' at the edge, which is what the API stores.
 */
const NO_AGENT = '__none__';

/** Which agent answers a chat platform's messages when none is mentioned. */
export function IntegrationAgentSelect({
  id,
  value,
  agents,
  disabled,
  onChange,
}: {
  id?: string;
  value: string;
  agents: WorkspaceAgent[];
  disabled?: boolean;
  onChange: (agent: string) => void;
}) {
  const t = useT();
  return (
    <Select
      value={value || NO_AGENT}
      onValueChange={(v) => onChange(v === NO_AGENT ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={NO_AGENT}>{t('admin.integrationNoDefaultAgent')}</SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.agentName} value={a.agentName}>
              {a.agentName}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
