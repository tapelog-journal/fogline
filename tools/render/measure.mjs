// Measures every board cell's rendered size across viewports/cosmetics. usage: node measure.mjs <url> [shotPath]
import puppeteer from "puppeteer-core";
const url = process.argv[2] ?? "http://localhost:8811/";
const shot = process.argv[3];
const VIEWS = (process.env.VIEWS ?? "1920x1080,1366x768,1280x800,390x844,1024x768,768x1024,2560x1440,1000x700").split(",").map((v) => v.split("x").map(Number));
const LOOKS = ["", "?skin=6&table=10&fog=20", "?skin=7&table=4&fog=19", "?skin=5&table=12", "?skin=8&table=11&step=60"];
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
const p = await b.newPage();
let worst = 0;
for (const [w, h] of VIEWS) for (const look of LOOKS) {
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.goto(url + look, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 300));
  const m = async () => p.evaluate(() => {
    const cs = [...document.querySelectorAll("#board .cell")].map((c) => c.getBoundingClientRect());
    const ws = cs.map((r) => r.width), hs = cs.map((r) => r.height);
    const all = [...ws, ...hs];
    const rows = {}; cs.forEach((r) => (rows[Math.round(r.top)] = (rows[Math.round(r.top)] || 0) + 1));
    return { n: cs.length, minW: Math.min(...ws), maxW: Math.max(...ws), minH: Math.min(...hs), maxH: Math.max(...hs), delta: Math.max(...all) - Math.min(...all), nonSquare: Math.max(...cs.map((r) => Math.abs(r.width - r.height))), frac: Math.max(...all.map((x) => Math.abs(x - Math.round(x)))), colsUniq: new Set(cs.map((r) => Math.round(r.left * 100))).size, rowsUniq: new Set(cs.map((r) => Math.round(r.top * 100))).size, rows: Object.keys(rows).length };
  });
  const r1 = await m();
  // during replay + effects
  const fxOK = await p.evaluate(() => { const F = window.__fogline; if (!F) return false; F.show(84, false); F.show(85, true); return true; });
  await new Promise((r) => setTimeout(r, 450));
  const r2 = await m();
  const d = Math.max(r1.delta, r1.nonSquare, r2.delta, r2.nonSquare);
  worst = Math.max(worst, d);
  console.log(`${w}x${h} ${look || "(default)"}: cells=${r1.n} w ${r1.minW.toFixed(2)}-${r1.maxW.toFixed(2)} h ${r1.minH.toFixed(2)}-${r1.maxH.toFixed(2)} delta=${r1.delta.toFixed(2)} nonSquare=${r1.nonSquare.toFixed(2)} | duringFx delta=${r2.delta.toFixed(2)} nonSquare=${r2.nonSquare.toFixed(2)} fx=${fxOK} frac=${r1.frac.toFixed(2)} grid=${r1.colsUniq}x${r1.rowsUniq}`);
}
if (shot) { await p.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 }); await p.goto(url + "?skin=6&table=10&fog=20&step=60", { waitUntil: "networkidle0" }); await new Promise((r) => setTimeout(r, 400)); await p.screenshot({ path: shot }); }
console.log("WORST", worst.toFixed(2));
await b.close();
