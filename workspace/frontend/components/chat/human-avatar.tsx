'use client';

import { User } from 'lucide-react';
import { humanColor } from '@/lib/human-color';

export function HumanAvatar({ email }: { email: string }) {
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: humanColor(email) }} aria-hidden="true"><User className="size-3.5 text-zinc-700" /></span>;
}
