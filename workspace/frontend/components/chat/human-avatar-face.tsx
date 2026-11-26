import { User } from 'lucide-react';
import { humanColor } from '@/lib/human-color';
import { cn } from '@/lib/utils';

/**
 * A person's avatar without the roster lookup: the photo when there is one,
 * else the person glyph on a colour seeded by their id/email/name. The
 * workspace's HumanAvatar resolves the photo from the team roster; the shared
 * thread pages (no roster) render this directly with the same seed.
 */
export function HumanAvatarFace({ seed, url, onError, className }: {
  seed: string;
  url?: string | null;
  onError?: () => void;
  className?: string;
}) {
  return (
    <span className={cn('flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full', className)} style={{ backgroundColor: humanColor(seed) }} aria-hidden="true">
      {url ? <img src={url} alt="" className="size-full object-cover" onError={onError} /> : <User className="size-3.5 text-foreground" />}
    </span>
  );
}
