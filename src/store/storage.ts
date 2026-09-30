// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { createJSONStorage, type StateStorage } from 'zustand/middleware';
import { L2_NAMESPACE } from '@/api/persistCache';

/**
 * In-memory stand-in used while rendering on the server.
 *
 * This matters more than it looks: `createJSONStorage(() => localStorage)`
 * swallows the ReferenceError thrown during SSR and returns `undefined`, and
 * zustand's persist middleware then bails out early *without* attaching
 * `api.persist`. The result is `useAppStore.persist === undefined` during
 * prerendering, which crashes every statically generated page.
 *
 * Returning a real (no-op) storage object keeps the middleware fully active on
 * both sides of the wire.
 */
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * Legt einen Schutzmantel um den echten `localStorage`.
 *
 * Warum nicht einfach `window.localStorage` zurückgeben: die Zustands-Schicht
 * läuft SYNCHRON im Klickpfad. `localStorage.setItem` wirft, sobald die Quote
 * voll ist (oder der Nutzer Speicher gesperrt hat) – und zustand reicht den
 * Fehler ungeschützt bis in den React-Handler durch (`Uncaught
 * QuotaExceededError`), sobald irgendetwas Persistiertes geschrieben wird
 * (Theme, Zeitrahmen, Token, Layout …). Der In-Memory-Zustand ist die Wahrheit;
 * Persistenz ist Kür und darf die Bedienung nie unterbrechen.
 *
 * Bei voller Quote wird zuerst der eigene Zwischenspeicher (L1/L2-Kerzen,
 * `nc-l2-v1:*`) verdrängt – dieselbe Rangfolge, die `api/persistCache.ts`
 * dokumentiert: Einstellungen sind wichtiger als zwischengespeicherte Daten.
 */
function guardedStorage(raw: Storage): StateStorage {
  const dropCacheEntries = () => {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < raw.length; i += 1) {
        const key = raw.key(i);
        if (key && key.startsWith(`${L2_NAMESPACE}:`)) doomed.push(key);
      }
      for (const key of doomed) raw.removeItem(key);
      return doomed.length;
    } catch {
      return 0;
    }
  };
  return {
    getItem: (name) => {
      try {
        return raw.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        raw.setItem(name, value);
        return;
      } catch {
        /* Quote voll oder Speicher gesperrt – s. o. */
      }
      if (dropCacheEntries() > 0) {
        try {
          raw.setItem(name, value);
        } catch {
          /* immer noch kein Platz – In-Memory-Zustand bleibt gültig */
        }
      }
    },
    removeItem: (name) => {
      try {
        raw.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

function resolveStorage(): StateStorage {
  if (typeof window === 'undefined') return noopStorage;
  try {
    // Safari private mode throws on access
    const probe = '__nc_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return guardedStorage(window.localStorage);
  } catch {
    return noopStorage;
  }
}

export const appStorage = createJSONStorage(resolveStorage);
