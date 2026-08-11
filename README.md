# Zap Extension

Chromium Manifest V3 extension for boosting webpages, inspired by Arc Browser's Boosts.
Zap a stray element, recolor something (or the whole page), swap in a different font, or
fix a label's text — all saved per-site so it stays boosted on future visits. Built with
Codex

## Setup

1. Install dependencies with `npm install`.
2. Build the extension with `npm run build`.
3. For active development, use `npm run dev` to rebuild on file changes.

## Load The Extension

1. Open `chrome://extensions` in Chrome, Arc, Edge, or Brave.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select the `dist` folder from this project.
5. Pin the extension if you want easier access from the toolbar.

## Use Boost mode

1. Open any regular `http` or `https` page.
2. Click the extension icon to open the popup.
3. Press `Boost mode`.
4. Pick a tool from the tabs in the on-page HUD: **Zap**, **Recolor**, **Font**, or **Text**.
5. Hover an element (it highlights), then click it:
   - **Zap** removes it immediately — click for permanent, `Shift`+click to remove it for
     this visit only (nothing is saved). If you change your mind right away, click `Undo`
     in the HUD.
   - **Recolor** opens a small form to set the element's text and/or background color,
     with a live preview. Check `Apply to whole page` to recolor the whole site instead
     of just that element.
   - **Font** opens a font field (pick a preset or type any CSS font stack) with a live
     preview, and the same `Apply to whole page` option.
   - **Text** opens a textarea prefilled with the element's current text; edit it and
     Save to permanently replace that label.
6. Press `Esc` to close an open editor, or press it again (or use `Stop` in the popup) to
   leave Boost mode entirely.

Notes:
- Whole-page recolor/font uses `!important` overrides across every element, which can
  occasionally clash with icon fonts (e.g. Font Awesome-style ligature icons).
- Text editing replaces an element's full text content, so it works best on simple
  labels rather than elements with nested markup.

## Restore Boosted Elements

1. Open the popup while you are on the same site.
2. Use `Restore` next to a single saved boost, or `Restore all` to remove every saved
   boost for that site.
3. Reload the page if the site does not immediately re-render the restored element.

## Manage All Boosts

Open `Manage all boosts` at the bottom of the popup to get a full-page view of every
saved boost across every site:

- Filter by type (Zap, Recolor, Font, Text) and search by site, label, selector, or value.
- Restore individual boosts, restore everything for one site, or restore everything
  everywhere.
- Export all saved boosts to a JSON file, or import a previously exported (or
  hand-written) JSON file to merge boosts back in.

## How it works

- Use the popup to enter Boost mode on the active tab; tool selection then happens in
  the on-page HUD.
- Each click saves a site-scoped rule (element selector + the change) to
  `chrome.storage.local`, tagged with a type: `remove`, `recolor`, `font`, or `text`.
- Zap, Recolor, and Font rules are applied by injecting CSS into the page (`display:
  none`, `color`/`background-color`, or `font-family`, all `!important`). Text rules are
  applied by the content script directly setting `textContent` on matching elements, and
  are re-applied if the site's own JavaScript changes the DOM back.
- Restore individual boosts, all current-site boosts, or everything everywhere from the
  popup or the `Manage all boosts` page.
