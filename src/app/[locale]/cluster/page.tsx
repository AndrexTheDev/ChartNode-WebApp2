// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StandaloneClusterPage } from '@/components/terminal/StandaloneClusterPage';
import { assertLocale } from '@/lib/locale-param';
import { buildAlternates, buildOpenGraph, buildTwitter, ROBOTS_DEFAULT } from '@/lib/seo';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = assertLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'nodecluster' });
  const title = t('standalone.pageTitle');
  const brandedTitle = `${title} | NodeChart`;
  const description = t('standalone.description');

  return {
    title: { absolute: brandedTitle },
    description,
    alternates: buildAlternates(locale, '/cluster'),
    openGraph: buildOpenGraph({ locale, title: brandedTitle, description, path: '/cluster' }),
    twitter: buildTwitter(brandedTitle, description),
    robots: ROBOTS_DEFAULT,
  };
}

export default async function ClusterPage({ params }: PageProps) {
  const locale = assertLocale((await params).locale);
  setRequestLocale(locale);

  return <StandaloneClusterPage />;
}
