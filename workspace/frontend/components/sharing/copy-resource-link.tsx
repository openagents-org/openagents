 'use client';
import { Link } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { resourcePath, type ResourceView } from '@/lib/resource-link';
import { shareOrigin } from '@/lib/share-origin';
import { useT } from '@/lib/i18n';
export function CopyResourceLink({ view, id }: { view: ResourceView; id: string }) {
  const { workspace } = useWorkspace();
  const t = useT();
  return <Button variant="ghost" mode="icon" size="sm" aria-label={t('issues.copyLink')} title={t('issues.copyLink')} onClick={async () => {
    try {
      const url = new URL(resourcePath(workspace?.slug || workspace?.workspaceId || '', view, id), shareOrigin());
      await navigator.clipboard.writeText(url.toString()); toast.success(t('common.copied'));
    } catch { toast.error(t('resourceLinks.copyFailed')); }
  }}><Link className="size-3.5" /></Button>;
}
