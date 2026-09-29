// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { whenIdle } from '@/lib/ads/adsterra';

/**
 * Lädt Werkzeuge erst, wenn sie gebraucht werden.
 *
 * Das Terminal hängt 15 Dialoge und zwei Docks in den Client-Baum. Statisch
 * importiert liegen sie alle im Erstkontakt-Bundle – gemessen 365 kB
 * komprimiertes JS auf /terminal, das die halbe Interaktionszeit vor dem
 * ersten Klick verbrennt (TBT 477 ms, Eingabelatenz 715 ms bei 4× CPU).
 *
 * `LazyGate` rendert seine Kinder deshalb erst, wenn `active` zum ersten Mal
 * true war; zusammen mit `next/dynamic()` heißt das: das Chunk lädt beim ersten
 * Öffnen statt beim Seitenaufbau. Beim allerersten Klick auf ein noch nicht
 * geladenes Werkzeug ist das Chunk bereits im HTTP-Cache, wenn die Idle-Warmup
 * es vorher geholt hat (siehe `warmToolChunks`) – sonst kostet es genau einen
 * Netz-Roundtrip, nie einen Blockade des Hauptthreads.
 *
 * Serverseitig und beim ersten Client-Render ist der Zustand identisch
 * (nichts gerendert) ⇒ kein Hydration-Mismatch, kein Layout-Sprung.
 */
export function LazyGate({
  active,
  warm = false,
  children,
}: {
  /** Werkzeug ist offen (bzw. wurde geöffnet). */
  active: boolean;
  /** Chunk beim nächsten Idle-Fenster nachladen (Klick bleibt sofort). */
  warm?: boolean;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    if (!active && !warm) return;
    // Deferred statt synchron: `setState` im Effect-Body löst Kaskaden aus
    // (React-Regel) – ein Tick später ist der Effekt identisch.
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, [active, warm, ready]);

  // `active` gewinnt immer: der erste Klick darf nie einen Frame warten.
  return ready || active ? <>{children}</> : null;
}

/**
 * Holt die Chunks der häufigsten Werkzeuge in der Idle-Zeit nach.
 *
 * Bewusst nur die fünf, die aus der Werkzeugleiste praktisch täglich geöffnet
 * werden; die übrigen bleiben echte On-Demand-Ladungen. Die Aufrufe mounten
 * nichts – sie wärmen ausschließlich den Modul-Cache, damit der erste Klick
 * ohne Netz-Wartezeit öffnet.
 */
export function warmToolChunks(): void {
  whenIdle(() => {
    void import('@/components/tools/BacktestModal');
    void import('@/components/tools/RiskModal');
    void import('@/components/tools/JournalModal');
    void import('@/components/tools/AlertsPanelModal');
    void import('@/components/tools/ScreenerModal');
  }, 3_000);
}
