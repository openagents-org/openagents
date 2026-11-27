'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Briefcase, CalendarDays, Search, TrendingUp } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useMyAcentaAgent } from '@/components/agents/use-my-acenta-agent';

const cards = [
  { icon: Briefcase, description: ['Find roles that match your experience.', '按你的经验筛选适合的岗位。'] },
  { icon: CalendarDays, description: ['Organize your schedule, emails or meeting notes.', '整理日程、邮件或会议纪要。'] },
  { icon: Search, description: ['Get a short brief with sources you can check.', '生成一份附可查来源的简报。'] },
  { icon: TrendingUp, description: ['Plan a campaign or compare competitors.', '制定推广计划或比较竞品。'] },
] as const;

export function AcentaStarterCards({ agentName, suggestions, onSuggestion }: {
  agentName: string;
  suggestions: string[];
  onSuggestion: (prompt: string) => void;
}) {
  const t = useT();
  const [assistant, setAssistant] = useState(false);
  const agent = useMyAcentaAgent(assistant ? agentName : undefined);
  const tasks = [
    { title: t('connect.acentaAssistantCalendar'), instructions: 'Organize a calendar export or pasted calendar events for next week. Flag conflicts and suggest preparation time. Ask me for the events if I have not shared them.' },
    { title: t('connect.acentaAssistantMail'), instructions: 'Turn emails I share into a prioritized to-do list. Flag what needs a reply and draft replies for review. Ask me for the messages if I have not shared them.' },
    { title: t('connect.acentaAssistantMeet'), instructions: 'Extract decisions, action items, owners and deadlines from meeting notes I share. Ask for the notes if I have not shared them.' },
  ];
  return (
    <section className="my-3 space-y-3 rounded-xl border bg-muted/25 p-4" aria-label={t('connect.acentaStarterTitle')}>
      <h3 className="text-sm font-semibold">{t('connect.acentaStarterTitle')}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {suggestions.map((label, index) => {
          const personal = label === 'Be my personal assistant' || label === '当我的私人助理';
          const description = cards[index]?.description;
          const Icon = personal ? CalendarDays : cards[index]?.icon ?? ArrowRight;
          return (
            <button key={label} type="button" aria-expanded={personal ? assistant : undefined}
              onClick={() => personal ? setAssistant(value => !value) : onSuggestion(label)}
              className="flex min-h-18 items-start gap-3 rounded-lg border bg-background p-3 text-left hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                {description && <span className="mt-0.5 block text-xs text-muted-foreground">{/[\u3400-\u9fff]/.test(label) ? description[1] : description[0]}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {assistant && (
        <div className="space-y-3 rounded-lg border bg-background p-3">
          <h4 className="text-sm font-semibold">{t('connect.acentaAssistantOptions')}</h4>
          <p className="text-xs text-muted-foreground">{t('connect.acentaAssistantInputs')}</p>
          <ul className="divide-y">
            {tasks.map(task => <li key={task.title}>
              <button type="button" className="flex min-h-10 w-full items-center justify-between gap-2 py-2 text-left text-sm hover:underline"
                onClick={() => onSuggestion(`${task.title}\n\n${task.instructions}`)}>
                {task.title}<ArrowRight className="size-4 shrink-0" aria-hidden />
              </button>
            </li>)}
          </ul>
          {agent?.url && <div className="border-t pt-3">
            <a href={`${agent.url}?tab=apps#chat-apps`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium underline">
              {t('connect.acentaAssistantApps')}<ArrowUpRight className="size-4" aria-hidden />
            </a>
            <p className="mt-1 text-xs text-muted-foreground">{t('connect.acentaAssistantAppHelp')}</p>
          </div>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('connect.acentaStarterCustom')}</p>
    </section>
  );
}
