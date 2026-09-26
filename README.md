# Zap Extension

Chromium Manifest V3 extension for boosting webpages, inspired by Arc Browser's Boosts.
Zap a stray element, recolor something (or the whole page), swap in a different font, or
fix a label's text — all saved per-site so it stays boosted on future visits.

## Install

1. Download the latest `zap-extension-v*.zip` from the
   [Releases page](https://github.com/shahparshva72/zap-extension/releases/latest).
2. Unzip it.
3. Open `chrome://extensions` in Chrome, Arc, Edge, or Brave and turn on `Developer mode`.
4. Click `Load unpacked` and select the unzipped folder (the one containing
   `manifest.json`).
5. Pin Zap from the extensions menu for easy access.

Zap makes no network requests: boosts are stored only in your browser's local extension
storage. It needs access to all `http`/`https` sites so saved boosts can re-apply
whenever you revisit a page.

## Build From Source

1. Install dependencies with `npm install`.
2. Build the extension with `npm run build`, then load the `dist` folder as described
   below.
3. For active development, use `npm run dev` to rebuild on file changes.

The content script is built separately (`vite.content.config.ts`) as one self-contained
file, because content scripts can't load `import`s. It can import from `src/shared`
like any other entry point.

## Load A Local Build

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
     with a live preview. Text color applies to everything inside the element (headings,
     links, spans), and a background color replaces any gradient or background image.
     Re-opening a recolored element starts from its saved colors. If you picked a single
     label, you can also change its text in the same editor (Font has this too); one Undo
     reverts both. Check `Apply to whole page` to recolor the whole site instead
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

## Manage All Boosts

Open `Manage all boosts` at the bottom of the popup to get a full-page view of every
saved boost across every site:

- Filter by type (Zap, Recolor, Font, Text) and search by site, label, selector, or value.
- Restore individual boosts, restore everything for one site, or restore everything
  everywhere.
- Export all saved boosts to a JSON file, or import a previously exported (or
  hand-written) JSON file to merge boosts back in.
  Exports include the URL and title of each boosted page, so check a file before sharing
  it.

## How it works

- Use the popup to enter Boost mode on the active tab; tool selection then happens in
  the on-page HUD.
- Each click saves a site-scoped rule (element selector + the change) to
  `chrome.storage.local`, tagged with a type: `remove`, `recolor`, `font`, or `text`.
- Zap, Recolor, and Font rules are applied by injecting CSS into the page (`display:
  none`, `color`/`background-color`, or `font-family`, all `!important`). Text rules are
  applied by the content script directly setting `textContent` on matching elements, and
  are re-applied if the site's own JavaScript changes the DOM back. A text rule only
  replaces text that still matches what it was created for, so content the site has
  since changed (a counter, a different item) is left alone.
- Colors and fonts are validated before they are saved, imported, or injected, so an
  imported or hand-edited value can't inject arbitrary CSS.
- Restore individual boosts, all current-site boosts, or everything everywhere from the
  popup or the `Manage all boosts` page.

## Releasing

1. Bump `version` in both `package.json` and `public/manifest.json` (they must match).
2. Run `npm run release` to build and package `release/zap-extension-v<version>.zip`
   locally, and check it loads with `Load unpacked`.
3. Commit, then tag and push, e.g. `git tag v0.2.0 && git push origin v0.2.0`. The
   `Release` GitHub Actions workflow builds the zip and publishes a GitHub Release with it
   attached. The tag must match the version, or the workflow fails.

The same zip can be uploaded to the Chrome Web Store.

## License

[MIT](LICENSE)
