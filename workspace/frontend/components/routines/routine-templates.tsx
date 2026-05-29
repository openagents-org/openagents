'use client';

import { X } from 'lucide-react';
import { ROUTINE_TEMPLATES, ROUTINE_TYPE_ICONS, type RoutineTemplate } from '@/lib/api-routines';

interface RoutineTemplatesProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: RoutineTemplate) => void;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatSchedule(template: RoutineTemplate): string {
  const time = `${String(template.scheduleHour).padStart(2, '0')}:${String(template.scheduleMinute).padStart(2, '0')} UTC`;
  if (template.scheduleDays.length === 7) {
    return `Daily at ${time}`;
  }
  if (template.scheduleDays.length === 5 && [0, 1, 2, 3, 4].every((d) => template.scheduleDays.includes(d))) {
    return `Weekdays at ${time}`;
  }
  const dayLabels = template.scheduleDays.map((d) => DAY_NAMES[d] || `${d}`).join(', ');
  return `${dayLabels} at ${time}`;
}

export function RoutineTemplates({ open, onClose, onSelectTemplate }: RoutineTemplatesProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-10 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📑</span>
          <h2 className="text-sm font-semibold">Routine Templates</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <p className="text-xs text-muted-foreground mb-3">
          Choose a template to quickly create a routine with pre-configured settings.
        </p>
        {ROUTINE_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelectTemplate(template)}
            className="w-full text-left rounded-lg border border-border bg-card p-3 hover:border-primary/40 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{ROUTINE_TYPE_ICONS[template.routineType]}</span>
              <span className="text-sm font-medium">{template.name}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              {template.description}
            </p>
            <div className="text-[10px] text-muted-foreground/70">
              {formatSchedule(template)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
