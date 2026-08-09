# Zap Extension

Chromium Manifest V3 extension for permanently zapping intrusive page elements inspired by Arc Browser's Zap feature in Arc Boosts. Built with Codex

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

## Use Zap

1. Open any regular `http` or `https` page.
2. Click the extension icon to open the popup.
3. Press `Zap mode`.
4. Hover the element you want to remove.
5. Click once to zap it.
6. Press `Esc` on the page or use `Stop` in the popup when you are done.

## Restore Hidden Elements

1. Open the popup while you are on the same site.
2. Use `Restore` next to a single saved zap, or `Restore all` to remove every saved zap for that site.
3. Reload the page if the site does not immediately re-render the restored element.

## How it works

- Use the popup to enter Zap mode on the active tab.
- Hover any element and click to remove it immediately.
- The extension stores a site-scoped selector in `chrome.storage.local`.
- On future visits, the content script injects CSS that keeps matching elements hidden.
- Restore individual zaps or all current-site zaps from the popup.
