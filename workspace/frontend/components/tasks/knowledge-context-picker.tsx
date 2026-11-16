'use client';

import { BookOpen } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';

/**
 * Multi-select of knowledge-base entries to attach as task context. Rendered
 * INLINE (a checkbox list) rather than as a portal dropdown — a nested Radix
 * portal inside the modal was easy to miss and flaky on mobile drawers. The
 * backend cites each entry as @knowledge:<slug> in the kickoff. Renders
 * nothing when the knowledge base is empty.
 */
export function KnowledgeContextPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  const { knowledge } = useWorkspace();
  if (knowledge.length === 0) return null;

  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...value.filter((x) => x !== id), id] : value.filter((x) => x !== id));

  return (
    <FieldSet className="gap-1.5">
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1.5 text-xs text-muted-foreground">
        <BookOpen className="size-3.5" />
        {t('tasks.fieldContext')}
        {value.length > 0 && (
          <span className="font-normal text-muted-foreground/70">
            · {t('tasks.contextCount', { count: value.length })}
          </span>
        )}
      </FieldLegend>
      <div className="flex max-h-40 flex-col divide-y overflow-y-auto rounded-md border">
        {knowledge.map((entry) => {
          const id = `knowledge-context-${entry.id}`;
          return (
            // The whole row is the label, so a click on the description or the
            // padding toggles the entry too.
            <FieldLabel key={entry.id} htmlFor={id} className="rounded-none border-0 font-normal">
              <Field orientation="horizontal" className="gap-2.5">
                <Checkbox
                  id={id}
                  checked={value.includes(entry.id)}
                  onCheckedChange={(checked) => toggle(entry.id, checked === true)}
                />
                <FieldContent className="min-w-0 gap-0">
                  <FieldTitle className="block w-full truncate text-xs">{entry.title}</FieldTitle>
                  {entry.description && (
                    <FieldDescription className="truncate text-xs">{entry.description}</FieldDescription>
                  )}
                </FieldContent>
              </Field>
            </FieldLabel>
          );
        })}
      </div>
      <FieldDescription className="text-xs">{t('tasks.contextHint')}</FieldDescription>
    </FieldSet>
  );
}
