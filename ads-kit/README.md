# Adsterra Popunder and Smartlink Kits

These standalone vanilla JavaScript files have no runtime package dependencies. They can load third-party Adsterra scripts or sponsored destinations, so “zero dependencies” does **not** mean zero third-party requests. Delivery, availability, content, tracking, and popup behavior depend on the ad provider, browser settings, region, and configured placement; this kit makes no delivery or revenue guarantee.

## Popunder kit

| File | Purpose |
|---|---|
| `landing-popunder.js` | Optional landing-page popunder hooks, session limits, and `pu:*` events. |
| `app-popunder.js` | Optional terminal popunder attempts with a configurable cooldown and retry window. |

Configure each script through its `CONFIG` object. The bundled defaults point to the NodeChart publisher placements; replace or disable them before reuse on another site. Popunders are attempted only from the script's configured triggers. Browsers, extensions, consent choices, or network failures may block them.

## Sponsored-link kit

| File | Purpose |
|---|---|
| `landing-smartlinks.js` | Adds visible labels to configured sponsored links, handles button-based links, and provides a direct-link fallback if a new tab is blocked. |
| `app-smartlinks.js` | Mounts a labelled sponsor strip and can display a delayed sponsored-link prompt after a host-page action. |
| `smartlinks.css` | Styling for labels, strips, fallback dialogs, and toasts. |
| `smartlinks-demo.html` | Local mock page for manual testing; the text and target are examples, not descriptions or guarantees of an actual offer. |

Configuration is at the top of each script. The default label is `Sponsored`; hosts can localize the visible label and fallback copy with the supported `data-config` override. The scripts add `rel="sponsored noopener"` to generated external anchors. A label describes the commercial relationship; it does not verify the destination, its terms, or the advertiser's claims.

## Disclosure and implementation notes

- Make the commercial nature of an ad or partner link clear before the user opens it. Do not describe a sponsored destination as a product feature or imply a bonus, return, contest entry, or other benefit unless the current destination and terms support that exact claim.
- The demo intentionally uses generic sponsor-link language. It does not promise a bonus, leverage, trading result, or verified share.
- The feature-action hook is intended to run after the host action and should not replace, delay, or imitate that action. Actual host-page behavior still needs testing.
- Popup blocking, ad blocking, consent settings, browser privacy controls, and provider changes can affect delivery. No script guarantees that a placement will load or bypass a blocker.
- This repository provides implementation labels and link attributes; it does not certify legal compliance. Review the applicable advertising, privacy, platform, and ad-network requirements for the deployment region.
