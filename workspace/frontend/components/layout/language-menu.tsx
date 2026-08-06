'use client';

import { Languages } from 'lucide-react';
import {
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { LOCALES, LOCALE_LABELS, isLocale, useI18n } from '@/lib/i18n';

/**
 * Language picker as a dropdown submenu, mirroring the theme picker beside it.
 *
 * Each option is labelled in its own language ("English", "简体中文") so it stays
 * readable no matter which locale is currently active.
 */
export function LanguageMenuSub() {
  const { locale, setLocale, isAutoDetected, t } = useI18n();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Languages />
        {t('language.label')}
        <span className="ms-auto pe-1 text-xs text-muted-foreground">
          {LOCALE_LABELS[locale]}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-44">
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) => {
              if (isLocale(value)) setLocale(value);
            }}
          >
            {LOCALES.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className="gap-2">
                {LOCALE_LABELS[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {isAutoDetected && (
            <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              {t('language.autoHint')}
            </p>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
