// Packages the built extension into release/zap-extension-v<version>.zip, with
// manifest.json at the zip root (the layout "Load unpacked" and the Chrome Web Store expect).
// Run via `npm run release`, which builds first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const { version } = readJson("package.json");
const manifestVersion = readJson("public/manifest.json").version;
if (version !== manifestVersion) {
  console.error(
    `Version mismatch: package.json is ${version} but public/manifest.json is ${manifestVersion}. ` +
      "Update both before releasing.",
  );
  process.exit(1);
}

const distDir = resolve(root, "dist");
if (!existsSync(resolve(distDir, "manifest.json")) || !existsSync(resolve(distDir, "assets/content.js"))) {
  console.error("dist/ is incomplete. Run `npm run build` first.");
  process.exit(1);
}

const releaseDir = resolve(root, "release");
const zipPath = resolve(releaseDir, `zap-extension-v${version}.zip`);
mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });

execFileSync("zip", ["-r", "-X", "-q", zipPath, ".", "-x", ".DS_Store", "*/.DS_Store"], {
  cwd: distDir,
  stdio: "inherit",
});

console.log(`Packaged ${zipPath}`);
