import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const path = (name) => `${root}${name}`;

for (const size of [16, 32, 48, 128]) {
  await sharp(path("public/icons/zap.svg"), { density: 384 })
    .resize(size, size).png().toFile(path(`public/icons/icon-${size}.png`));
}
await sharp(path("public/icons/zap.svg"), { density: 576 })
  .resize(1024, 1024).png().toFile(path("brand/zap-logo-1024.png"));
for (const [name, width, height] of [["promo-small", 440, 280], ["promo-marquee", 1400, 560]]) {
  await sharp(path(`store/${name}.svg`), { density: 144 })
    .resize(width, height).flatten({ background: "#17181a" }).png()
    .toFile(path(`store/${name}.png`));
}

const demo = await readFile(path("store/demo.html"));
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.ZAP_CHROME_PATH,
    headless: true,
    pipe: true,
    enableExtensions: [path("dist")],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().startsWith("http://fieldnotes.test/")) {
      void request.respond({ status: 200, contentType: "text/html", body: demo });
    } else {
      void request.continue();
    }
  });
  await page.goto("http://fieldnotes.test/slow-living");
  const target = await browser.waitForTarget((item) => item.type() === "service_worker");
  const worker = await target.worker();
  const extensionId = new URL(target.url()).host;
  const enter = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "http://fieldnotes.test/*" });
    await chrome.tabs.sendMessage(tab.id, { type: "ENTER_BOOST_MODE" });
  });
  await enter();
  const cdp = await page.createCDPSession();
  await cdp.send("DOM.enable");

  // CDP can inspect the real closed shadow root without changing the extension.
  async function nodes() {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const all = [];
    function walk(node) {
      all.push(node);
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    }
    walk(root);
    return all;
  }
  async function button(label) {
    const node = (await nodes()).find((node) => node.nodeName === "BUTTON"
      && node.children?.some((child) => child.nodeValue === label));
    assert.ok(node, `Missing button: ${label}`);
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId });
    await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
  }
  async function input(type, index, value) {
    const node = (await nodes()).filter((node) => type === "textarea"
      ? node.nodeName === "TEXTAREA"
      : node.nodeName === "INPUT" && node.attributes?.includes(type))[index];
    assert.ok(node, `Missing input: ${type}[${index}]`);
    const { object } = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function(value) { this.value = value; this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); }",
      arguments: [{ value }],
    });
  }
  async function capture(name) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path(`store/screenshot-${name}.png`) });
    console.log(`Captured ${name}`);
  }
  async function saved(count) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const rules = await worker.evaluate(async () => (await chrome.storage.local.get("boostRulesV1")).boostRulesV1 || []);
      if (rules.length === count) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Expected ${count} saved boosts`);
  }

  await page.mouse.move(899, 428);
  await new Promise((resolve) => setTimeout(resolve, 180));
  await capture("01-zap");
  await page.mouse.click(899, 428);
  await saved(1);
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#newsletter")).display === "none");

  await button("Recolor");
  await page.mouse.click(62, 150);
  await input("color", 0, "#17181a");
  await input("color", 1, "#fff1b8");
  await capture("02-recolor");
  await button("Save");
  await saved(2);

  await button("Font");
  await page.click("#headline");
  await input("text", 0, "Georgia, serif");
  await capture("03-font");
  await button("Save");
  await saved(3);

  await button("Text");
  await page.click("#headline");
  await input("textarea", 0, "Less noise.\nMore possibility.");
  await capture("04-text");
  await button("Save");
  await saved(4);

  await page.reload();
  await page.waitForFunction(() => document.querySelector("#headline").textContent === "Less noise.\nMore possibility.");
  assert.equal(await page.$eval("#newsletter", (node) => getComputedStyle(node).display), "none");
  assert.equal(await page.$eval("#story", (node) => getComputedStyle(node).backgroundColor), "rgb(255, 241, 184)");
  assert.match(await page.$eval("#headline", (node) => getComputedStyle(node).fontFamily), /Georgia/);

  await page.goto(`chrome-extension://${extensionId}/manage.html`);
  await page.waitForSelector(".site-group");
  await page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    await chrome.tabs.setZoom(tab.id, 1.5);
  });
  await capture("05-manage");
  console.log("Verified: all four boosts persist after reload.");
} finally {
  await browser?.close();
}
