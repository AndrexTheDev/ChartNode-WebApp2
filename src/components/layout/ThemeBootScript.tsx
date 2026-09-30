// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { STORAGE_KEY } from '@/lib/constants';
import { THEME_COLOR } from '@/lib/theme';
import type { ThemeId } from '@/store/types';

/**
 * Inline, render-blocking script that applies the persisted theme BEFORE the
 * first paint. Without it users would see a flash of the default skin.
 * Must stay dependency-free (runs before hydration) and must never throw.
 *
 * Security: the persisted theme id is validated against a fixed whitelist
 * regex before it touches the DOM, so a hand-edited `localStorage` value can
 * never reach `dataset.theme` or the meta tag. The theme-color map is baked
 * in as a JSON literal (no import at runtime, no string concatenation from
 * storage) and stays in sync with `applyTheme()` in `lib/theme.ts`.
 */
const THEME_IDS = Object.keys(THEME_COLOR) as ThemeId[];
const THEME_WHITELIST = `^(${THEME_IDS.join('|')})$`;
const THEME_COLOR_MAP = JSON.stringify(THEME_COLOR);

export function ThemeBootScript() {
  // Zusätzlich zur Theme-Wahl markiert das Skript vor dem ersten Paint, ob
  // Werbung unterdrückt ist (Spender-Grace oder QA). Die Werbeplätze sind
  // serverseitig reserviert (kein CLS beim Fill); ohne diese Markierung würde
  // die Reservierung für Spender erst nach der Hydration verschwinden und die
  // Seite dabei um bis zu 168 px springen (gemessen 0,109 CLS). CSS-first,
  // damit React-Baum und Hydration unverändert bleiben.
  const code = `(function(){try{var k=${JSON.stringify(STORAGE_KEY)};var colors=${THEME_COLOR_MAP};var wl=${JSON.stringify(THEME_WHITELIST)};var t='acid';var r=document.documentElement;var s=localStorage.getItem(k);if(s){var p=JSON.parse(s);if(p&&p.state&&typeof p.state.theme==='string'&&new RegExp(wl).test(p.state.theme))t=p.state.theme;}r.dataset.theme=t;if(t!=='light')r.classList.add('dark');else r.classList.remove('dark');var c=colors[t]||colors.acid;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',c);var off=false;try{var v=localStorage.getItem('nc-viral-v1');if(v){var q=JSON.parse(v);var st=q&&q.state?q.state:{};var at=Number(st.lastDonationAt)||0;if(at>0){var usd=Number(st.lastDonationUsd)||0;var span=usd>5?432000000:172800000;off=at+span>Date.now();}}}catch(e2){}if(!off){try{if(sessionStorage.getItem('nc-adcheck')==='1')off=true;}catch(e4){}}try{if(!off&&navigator.webdriver)off=true;}catch(e3){}if(off)r.setAttribute('data-nc-adsuppressed','1');
/* Sprachhinweis (LocaleDetectBanner) vor dem ersten Paint ankündigen: dieselbe
   Entscheidung wie in der Komponente (keine manuelle Sprachwahl, nicht in
   dieser Sitzung weggeklickt, Browsersprache weicht von der Seiten-Sprache ab).
   Damit kann CSS die Höhe reservieren – das Banner bleibt IM FLUSS (verdeckt
   also keine Bedienelemente mehr), kostet aber 0 CLS. */
try{var chosen=false;try{chosen=!!localStorage.getItem('nodechart:locale-chosen');}catch(e6){}
var dismissed=false;try{dismissed=!!sessionStorage.getItem('nodechart:locale-banner-dismissed');}catch(e7){}
var page=String(r.lang||'').toLowerCase().split('-')[0];
var langs=navigator.languages||[navigator.language||''];
var other=null;
for(var i=0;i<langs.length;i++){var c=String(langs[i]||'').toLowerCase().split('-')[0];if(c&&c!==page){other=c;break;}}
if(!chosen&&!dismissed&&other)r.setAttribute('data-nc-langhint','1');
}catch(e8){}try{var mm=window.matchMedia&&window.matchMedia('(pointer: coarse)');var touch=(mm&&mm.matches)||('ontouchstart' in window)||(navigator.maxTouchPoints>0);if(touch)r.setAttribute('data-nc-touch','1');}catch(e5){}}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
