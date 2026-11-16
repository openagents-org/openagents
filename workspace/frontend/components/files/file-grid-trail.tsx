'use client';

import { ArrowLeft, ChevronRight, PanelLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The Files header title: the trail to the folder on screen and how many
 * things are in it. Searching changes neither — it narrows this folder, so the
 * folder is still what you're looking at. The trail starts at the picked
 * folder: there's no root above it to climb to.
 */
export function FileGridTrail({
  breadcrumbs,
  itemCount,
  upLabel,
  onUp,
  onCrumb,
  onBrowseFolders,
}: {
  breadcrumbs: string[];
  itemCount: number;
  upLabel: string;
  onUp: () => void;
  onCrumb: (index: number) => void;
  /** Mobile only: the way back to the folder tree in the other pane. */
  onBrowseFolders?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
      {breadcrumbs.length === 0 ? (
        <>
          {/* It takes the back button's slot at the top of the path, so
              climbing out of a folder ends here rather than skipping the
              recent list entirely. */}
          {onBrowseFolders && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBrowseFolders}
              className="me-1 shrink-0 text-muted-foreground"
              title={t('files.browseFolders')}
              aria-label={t('files.browseFolders')}
            >
              <PanelLeft />
            </Button>
          )}
          <span className="shrink-0 px-1.5 py-0.5 font-medium">{t('files.allFiles')}</span>
        </>
      ) : (
        <>
          {/* At a nested level this goes to the parent. At the first level it
              clears the selected folder and returns to the unselected state. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onUp}
            className="me-1 shrink-0 text-muted-foreground"
            title={upLabel}
            aria-label={upLabel}
          >
            <ArrowLeft />
          </Button>
          {breadcrumbs.map((segment, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3.5 opacity-40" />}
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onCrumb(i)}
                className={cn(
                  'px-1.5 text-sm font-normal text-muted-foreground',
                  i === breadcrumbs.length - 1 && 'font-medium text-foreground',
                )}
              >
                {segment}
              </Button>
            </span>
          ))}
        </>
      )}
      {itemCount > 0 && (
        <Badge variant="secondary" className="ms-1.5 shrink-0">
          {itemCount}
        </Badge>
      )}
    </div>
  );
}
