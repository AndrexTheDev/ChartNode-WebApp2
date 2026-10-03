// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BenefitSection } from '@/components/landing/BenefitSection';
import { CtaSection } from '@/components/landing/CtaSection';
import { Hero } from '@/components/landing/Hero';
import { Ticker } from '@/components/landing/Ticker';
import { SmartlinkKit } from '@/components/ads/SmartlinkKit';
import { JsonLd } from '@/components/seo/JsonLd';
import { softwareApplicationLd } from '@/lib/jsonld';
import { assertLocale } from '@/lib/locale-param';
import { buildAlternates, buildOpenGraph, metaDescription } from '@/lib/seo';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  const title = t('title');
  const description = metaDescription(t('description'));

  return {
    title,
    description,
    alternates: buildAlternates(locale),
    openGraph: buildOpenGraph({ locale, title, description }),
  };
}

export default async function LandingPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  // Structured data mirrors the currently rendered access/details rows.
  const [tb, tm] = await Promise.all([
    getTranslations({ locale, namespace: 'benefit' }),
    getTranslations({ locale, namespace: 'meta' }),
  ]);
  const access = tb.raw('paid') as { feat: string; gate: string }[];
  const notes = tb.raw('unique') as string[];
  const featureList = [...access.map((item) => `${item.feat}: ${item.gate}`), ...notes];

  return (
    <>
      <JsonLd data={softwareApplicationLd(locale, featureList, tm('shortDescription'))} />
      <Hero locale={locale} />
      <Ticker locale={locale} />
      <BenefitSection locale={locale} />
      <CtaSection locale={locale} />
      {/* Smartlink-Kit (Landing): Enhancement, Cap-Tracking, Fallback-Modal */}
      <SmartlinkKit surface="landing" />
    </>
  );
}
