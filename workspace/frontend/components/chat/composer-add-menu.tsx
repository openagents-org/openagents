'use client';

import { CalendarClock, ImageIcon, Paperclip, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';

/** Everything in the composer that isn't typing or sending lives behind the `+`. */
export function ComposerAddMenu({ onPickFile, onCreateRoutine }: {
  onPickFile: (accept?: string) => void;
  onCreateRoutine?: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full text-muted-foreground"
          title={t('chatInput.addAttachments')}
          aria-label={t('chatInput.addAttachments')}
        >
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-50">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => onPickFile()}>
            <Paperclip />
            {t('chatInput.attachFile')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onPickFile('image/*')}>
            <ImageIcon />
            {t('chatInput.attachImage')}
          </DropdownMenuItem>
          {onCreateRoutine && (
            <DropdownMenuItem onSelect={() => onCreateRoutine()}>
              <CalendarClock />
              {t('chatInput.createRoutine')}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
