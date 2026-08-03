'use client';

import { useT } from '@/lib/i18n';

export default function NotFound() {
  const t = useT();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">{t('notFound.title')}</p>
    </div>
  );
}
