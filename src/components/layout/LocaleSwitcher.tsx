// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { LOCALE_LIST, LOCALE_META } from '@/lib/locales';
import { LOCALE_CHOICE_KEY } from './LocaleDetectBanner';

/**
 * Language menu. Locale-aware routing keeps the user on the same page and
 * lets next-intl persist NEXT_LOCALE. Shareable surfaces can also retain their
 * query string and hash when the language changes.
 */
export function LocaleSwitcher({ preserveQuery = false }: { preserveQuery?: boolean }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const meta = LOCALE_META[locale];

  const items: DropdownItem[] = LOCALE_LIST.map((entry) => ({
    id: entry.code,
    label: entry.nativeLabel,
    hint: entry.label === entry.nativeLabel ? entry.htmlLang : entry.label,
    badge: entry.short,
    selected: entry.code === locale,
    onSelect: () => {
      if (entry.code === locale) return;
      // A manual choice permanently wins over automatic detection.
      try {
        localStorage.setItem(LOCALE_CHOICE_KEY, entry.code);
      } catch {
        /* storage blocked – the cookie set by next-intl is enough */
      }
      const destination = preserveQuery && typeof window !== 'undefined'
        ? `${pathname}${window.location.search}${window.location.hash}`
        : pathname;
      router.replace(destination as typeof pathname, { locale: entry.code });
    },
  }));

  return (
    <Dropdown
      items={items}
      triggerLabel={t('selectLanguage')}
      menuLabel={t('language')}
      triggerIcon={<Globe className="size-3.5" aria-hidden />}
      triggerText={meta.short}
    />
  );
}
