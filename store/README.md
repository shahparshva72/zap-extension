# Zap store assets

The logo combines a solid **Z** with a lightning bolt. Its yellow (`#ffd83d`)
and charcoal (`#17181a`) match Zap’s interface. The standalone mark is a single
filled path, with no fonts, strokes, filters, or external resources.

## Upload these files

Privacy policy URL for the dashboard:
[Zap Privacy Policy](https://github.com/shahparshva72/zap-extension/blob/main/PRIVACY.md).

| Asset | Size | File |
| --- | --- | --- |
| Store icon | 128 × 128 | [icon-128.png](../public/icons/icon-128.png) |
| Small promotional tile — required | 440 × 280 | [promo-small.png](promo-small.png) |
| Marquee — optional | 1400 × 560 | [promo-marquee.png](promo-marquee.png) |
| Screenshot 1 — select an element to remove | 1280 × 800 | [screenshot-01-zap.png](screenshot-01-zap.png) |
| Screenshot 2 — recolor a section | 1280 × 800 | [screenshot-02-recolor.png](screenshot-02-recolor.png) |
| Screenshot 3 — change a heading’s font | 1280 × 800 | [screenshot-03-font.png](screenshot-03-font.png) |
| Screenshot 4 — rewrite a heading | 1280 × 800 | [screenshot-04-text.png](screenshot-04-text.png) |
| Screenshot 5 — manage saved boosts | 1280 × 800 | [screenshot-05-manage.png](screenshot-05-manage.png) |

The screenshots show the actual built extension running in an isolated Chrome
profile. Fieldnotes is a fictional demonstration website, served from the local
`demo.html` fixture through browser request interception at `fieldnotes.test`.
The first screenshot shows the hover highlight; screenshots 2–4 show live editing
previews. The final screenshot shows the saved rules at 150% browser zoom.
No extension controls were recreated or added to these images.

All screenshots and promotional PNGs have opaque backgrounds. The icon retains
transparent padding: its 96 × 96 tile sits inside a 128 × 128 canvas.
Dimensions follow the [Chrome Web Store image requirements](https://developer.chrome.com/docs/webstore/images).

## Logo files

- [Color logo SVG](../public/icons/zap.svg): the yellow tile and charcoal mark.
- [Single-color mark SVG](../brand/zap-mark.svg): transparent background, uses `currentColor`.
- [Large logo PNG](../brand/zap-logo-1024.png): 1024 × 1024 with transparency.
- `public/icons/icon-{16,32,48,128}.png`: extension icons, already referenced by the manifest.
- `promo-small.svg` and `promo-marquee.svg`: editable promotional artwork. These use
  Helvetica Neue/Helvetica and Menlo with fallbacks; the supplied PNGs are rendered
  on macOS and do not depend on fonts being installed on the viewer’s computer.

## Regenerate

The asset tooling is separate from the extension’s dependencies:

```bash
npm install --prefix store
npm run generate --prefix store
```

Puppeteer installs a compatible Chrome by default. To use an installed Chrome on macOS:

```bash
ZAP_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run generate --prefix store
```

The generator renders the PNGs, rebuilds the extension, captures all five
screenshots, and checks that removal, recoloring, font changes, and text changes
persist after reloading. It uses a temporary browser profile and closes it afterward.
Run `npm run release` from the repository root to package the extension with its icons.
Store artwork stays outside the extension package.
