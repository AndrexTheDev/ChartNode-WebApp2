// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Tastatur-Fokus in Dialogen und Overlays.
 *
 * Warum nicht einfach `querySelectorAll('button, [href], input, …')`?
 * Zwei Fallen, die genau diese naive Abfrage in der Praxis reißt:
 *
 *  1. `tabindex="-1"`-Elemente (z. B. die Optionsbuttons der Befehlspalette,
 *     die per `aria-activedescendant` gesteuert werden) stehen im DOM wie
 *     normale Buttons, sind aber KEINE Tab-Stationen. Wer sie mitzählt, hält
 *     ein falsches Element für das „letzte" und die Falle greift nicht.
 *  2. Chrome macht scrollbare Container ohne `tabindex` tabbar
 *     („keyboard-focusable scroller"). Solche Elemente fehlen in jeder
 *     Attribut-Abfrage, obwohl der Nutzer sie mit Tab erreicht.
 *
 * Deshalb: Kandidaten über `el.tabIndex >= 0` filtern (erkennt beide Fälle
 * korrekt) und Tab nur dann abfangen, wenn der Browser den Dialog sonst
 * verlassen würde – die native Reihenfolge (z. B. Radiogruppen mit einem
 * einzigen Tab-Stop) bleibt so erhalten.
 */

const CANDIDATE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]';

/** Alle echten Tab-Stationen innerhalb von `root`, in DOM-Reihenfolge. */
export function focusablesWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)].filter((el) => {
    // `disabled` ändert `tabIndex` NICHT (ein disabled-Button meldet weiter 0) –
    // ohne diese Zeile hielte die Falle einen deaktivierten Button für die
    // nächste Tab-Station und der Fokus bliebe stehen.
    if (el.hasAttribute('disabled') || el.matches(':disabled')) return false;
    if (el.tabIndex < 0) return false; // tabindex="-1"
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.getClientRects().length === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  });
}

/**
 * Hält den Fokus beim Tabulieren im Dialog. Gibt `true` zurück, wenn der
 * Aufrufer das Event bereits behandelt hat (Default verhindert + Fokus gesetzt).
 */
export function trapTabKey(event: KeyboardEvent, root: HTMLElement): boolean {
  const list = focusablesWithin(root);
  if (list.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  const contained = !!active && (active === root || root.contains(active));
  const hasCandidate = (ahead: boolean) =>
    contained &&
    list.some((el) => el !== active && (active!.compareDocumentPosition(el) & (ahead ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)) !== 0);

  if (!event.shiftKey) {
    if (hasCandidate(true)) return false; // Browser darf nativ weiterrücken
    event.preventDefault();
    (list[0] as HTMLElement).focus();
    return true;
  }
  if (hasCandidate(false)) return false;
  event.preventDefault();
  (list[list.length - 1] as HTMLElement).focus();
  return true;
}
