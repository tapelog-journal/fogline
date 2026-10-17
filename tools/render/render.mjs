// Render Fogline cosmetic images + previews with headless Chrome (puppeteer-core). $0, local only.
// usage: node render.mjs <baseUrl> <outPreviewsDir>
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { CATALOG, tokenFile } from "../../docs/art/catalog.js";

const base = process.argv[2] ?? "http://localhost:8811";
const prev = process.argv[3] ?? "/workspace/fogline-previews";
const repo = new URL("../../", import.meta.url).pathname;
const imgDir = join(repo, "docs/cosmetics/img");
mkdirSync(imgDir, { recursive: true }); mkdirSync(prev, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"], headless: true });
const page = await browser.newPage();
const only = process.env.ONLY ?? "items,sheet,base,hero,clip";

if (only.includes("items")) {
  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
  for (const it of CATALOG) {
    await page.goto(`${base}/art/sheet.html?item=${it.id}`, { waitUntil: "networkidle0" });
    await page.waitForFunction("window.__ready"); await new Promise((r) => setTimeout(r, 250));
    const el = await page.$(".card");
    await el.screenshot({ path: join(imgDir, `${it.id}.png`) });
  }
  console.log("item images ->", imgDir);
}
if (only.includes("sheet")) {
  await page.setViewport({ width: 3300, height: 2200, deviceScaleFactor: 1 });
  await page.goto(`${base}/art/sheet.html?all=1`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: join(prev, "catalog-contact-sheet.png"), fullPage: true });
  console.log("contact sheet");
}
if (only.includes("base")) {
  await page.setViewport({ width: 1180, height: 400, deviceScaleFactor: 2 });
  await page.goto(`${base}/art/sheet.html?base=1`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: join(prev, "base-pieces.png"), fullPage: true });
  await page.screenshot({ path: join(repo, "docs/art/base-pieces.png"), fullPage: true });
}
if (only.includes("hero")) {
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 });
  await page.goto(`${base}/?skin=6&table=10&fog=20&trail=18&banner=21&fx=13,14,15,16&step=116`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => window.__fogline.show(117, true));
  await new Promise((r) => setTimeout(r, 1300));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  await page.screenshot({ path: join(prev, "hero-viewer-obsidian-deepspace.png") });
  await page.goto(`${base}/?skin=5&table=12&fog=20&tab=table`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: join(prev, "viewer-neon-arcade.png") });
  console.log("hero");
}
if (only.includes("clip")) {
  // deterministic frames: pause all animations and scrub currentTime
  const frames = join(prev, ".frames"); mkdirSync(frames, { recursive: true });
  await page.setViewport({ width: 700, height: 700, deviceScaleFactor: 1 });
  const clips = [["mine-blast", 15, 3, 0, 1300], ["beacon-victory", 16, 9, 6, 2900], ["capture-burst", 13, 10, 5, 1000]];
  for (const [name, fx, table, skin, dur] of clips) {
    await page.goto(`${base}/?skin=${skin}&table=${table}&banner=21&step=60`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    const box = await page.evaluate(() => { const r = document.getElementById("stage").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.width }; });
    await page.evaluate((fx) => { const F = window.__fogline; if (fx === 16) F.A.showBanner(document.getElementById("stage"), 21, "Victory", "Beacon captured"); F.demoEffect(fx); document.getAnimations().forEach((a) => a.pause()); }, fx);
    const n = Math.round(dur / 40);
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; }), i * 40);
      await page.screenshot({ path: join(frames, `${name}-${String(i).padStart(4, "0")}.png`), clip: box });
    }
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "25", "-i", join(frames, `${name}-%04d.png`), "-vf", "scale=600:-2,format=yuv420p", "-c:v", "libx264", "-movflags", "+faststart", join(prev, `effect-${name}.mp4`)]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "25", "-i", join(frames, `${name}-%04d.png`), "-vf", "scale=420:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer", join(prev, `effect-${name}.gif`)]);
    console.log("clip", name, n, "frames");
  }
}
await browser.close();
