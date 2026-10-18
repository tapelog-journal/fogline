// Renders the Fogline X teaser deterministically (frame-by-frame scrubbing) to MP4 + poster.
import puppeteer from "puppeteer-core";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const base = process.argv[2] ?? "http://localhost:8811";
const out = process.argv[3] ?? "/workspace/fogline-previews";
const FPS = 30, frames = join(out, ".teaser-frames");
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"], headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
await page.goto(`${base}/art/teaser.html`, { waitUntil: "networkidle0" });
await page.waitForFunction("window.__teaser");
const DUR = await page.evaluate(() => window.__teaser.DUR);
const n = Math.round(DUR * FPS);
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.__teaser.frame(t), i / FPS);
  await page.screenshot({ path: join(frames, `f${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 93 });
}
// poster: mid Beacon Victory
await page.goto(`${base}/art/teaser.html`, { waitUntil: "networkidle0" });
for (let t = 0; t <= 17.6; t += 1 / FPS) await page.evaluate((t) => window.__teaser.frame(t), t);
await page.screenshot({ path: join(out, "fogline-teaser-poster.png") });
await browser.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%05d.jpg"),
  "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  "-vf", "scale=1920:1080:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p", "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "19",
  "-r", String(FPS), "-g", String(FPS * 2), "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", join(out, "fogline-teaser.mp4")]);
rmSync(frames, { recursive: true, force: true });
console.log("done", n, "frames");
