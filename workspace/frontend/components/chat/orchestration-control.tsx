'use client';

import * as React from 'react';
import { Waypoints, Crown, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { WorkspaceSession, WorkspaceAgent } from '@/lib/types';

type Mode = 'dynamic' | 'master' | 'workflow';

const MODES: { value: Mode; label: string; icon: React.ElementType; description: string }[] = [
  {
    value: 'dynamic',
    label: 'Dynamic',
    icon: Sparkles,
    description: 'A router model picks the best next agent each turn.',
  },
  {
    value: 'master',
    label: 'Master / sub-agents',
    icon: Crown,
    description: 'Everything goes to the leader, who delegates and collects results.',
  },
  {
    value: 'workflow',
    label: 'Custom workflow',
    icon: Waypoints,
    description: 'Write a plan in plain language; the router follows it.',
  },
];

interface Props {
  session: WorkspaceSession;
  agents: WorkspaceAgent[];
  onChange: (updates: { mode?: Mode; instruction?: string | null }) => void;
}

/**
 * Header control that lets the user pick how a multi-agent thread coordinates:
 * dynamic router (default), master/sub-agent, or a custom natural-language
 * workflow. The custom workflow opens an editor with @agent autocomplete.
 */
export function OrchestrationControl({ session, agents, onChange }: Props) {
  const mode = (session.orchestrationMode || 'dynamic') as Mode;
  const active = MODES.find((m) => m.value === mode) || MODES[0];
  const [planOpen, setPlanOpen] = React.useState(false);

  const selectMode = (next: Mode) => {
    if (next === 'workflow') {
      // Entering workflow mode always opens the plan editor so the user can
      // author (or review) the plan the router will follow.
      setPlanOpen(true);
      if (mode !== 'workflow') onChange({ mode: 'workflow' });
    } else {
      onChange({ mode: next });
    }
  };

  const ActiveIcon = active.icon;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs font-medium"
            title="Collaboration mode"
          >
            <ActiveIcon className="size-3.5" />
            <span className="hidden lg:inline">{active.label}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Collaboration mode</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = m.value === mode;
            return (
              <DropdownMenuItem
                key={m.value}
                onSelect={(e) => {
                  // Keep the menu semantics simple; workflow opens a dialog.
                  e.preventDefault();
                  selectMode(m.value);
                }}
                className="flex items-start gap-2 py-2 cursor-pointer"
              >
                <Icon className="size-3.5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{m.label}</span>
                    {isActive && <Check className="size-3 text-primary" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{m.description}</p>
                </div>
              </DropdownMenuItem>
            );
          })}
          {mode === 'workflow' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setPlanOpen(true);
                }}
                className="text-xs cursor-pointer"
              >
                Edit workflow plan…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkflowPlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        agents={agents}
        initialValue={session.orchestrationInstruction || ''}
        onSave={(instruction) => onChange({ mode: 'workflow', instruction: instruction || null })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Plan editor with @agent autocomplete
// ---------------------------------------------------------------------------

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: WorkspaceAgent[];
  initialValue: string;
  onSave: (instruction: string) => void;
}

function WorkflowPlanDialog({ open, onOpenChange, agents, initialValue, onSave }: DialogProps) {
  const [value, setValue] = React.useState(initialValue);
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionFilter, setMentionFilter] = React.useState('');
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Reset the draft whenever the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setValue(initialValue);
      setShowMentions(false);
    }
  }, [open, initialValue]);

  const filteredAgents = React.useMemo(
    () => agents.filter((a) => a.agentName.toLowerCase().includes(mentionFilter.toLowerCase())),
    [agents, mentionFilter],
  );

  const detectMention = (el: HTMLTextAreaElement, text: string) => {
    const cursor = el.selectionStart;
    const before = text.slice(0, cursor);
    const at = before.match(/@([\w-]*)$/);
    if (at && agents.length > 0) {
      setMentionFilter(at[1]);
      setMentionIndex(0);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (name: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const at = before.lastIndexOf('@');
    if (at === -1) return;
    const next = before.slice(0, at) + `@${name} ` + after;
    setValue(next);
    setShowMentions(false);
    // Restore caret just after the inserted mention.
    requestAnimationFrame(() => {
      const pos = at + name.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((p) => (p + 1) % filteredAgents.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((p) => (p - 1 + filteredAgents.length) % filteredAgents.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredAgents[mentionIndex].agentName);
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
    }
  };

  const save = () => {
    onSave(value.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Custom collaboration workflow</DialogTitle>
          <DialogDescription>
            Describe, in plain language, how the agents should collaborate. Use{' '}
            <span className="font-mono">@</span> to reference an agent. The router follows this plan
            when deciding who responds next.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              detectMention(e.target, e.target.value);
            }}
            onKeyDown={onKeyDown}
            rows={6}
            autoFocus
            placeholder={
              'e.g. First @tester writes test cases for the requirement. Then @coder ' +
              'implements the code. Finally @reviewer runs the tests and fixes any bugs.'
            }
            className="w-full resize-none rounded-md border bg-transparent p-3 text-sm outline-none focus:border-primary"
          />
          {showMentions && filteredAgents.length > 0 && (
            <div className="absolute left-3 right-3 z-50 mt-1 max-h-44 overflow-auto rounded-md border bg-popover shadow-md">
              {filteredAgents.map((a, i) => (
                <button
                  key={a.agentName}
                  type="button"
                  onClick={() => insertMention(a.agentName)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent',
                    i === mentionIndex && 'bg-accent',
                  )}
                >
                  <span className="font-medium">@{a.agentName}</span>
                  {a.role === 'master' && <Crown className="size-3 text-amber-500" />}
                  <span
                    className={cn(
                      'ml-auto size-1.5 rounded-full',
                      a.status === 'online' ? 'bg-green-500' : 'bg-zinc-400',
                    )}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
