// Fogline art system: original SVG pieces, tabletops, effects, trails, fog styles and banners.
// All art is original TapeLog work. Cosmetics are purely decorative with zero gameplay effect.
// Game for entertainment. Not investment advice.

export const RANKS = ["Beacon", "Ghost", "Scout", "Sapper", "Guard", "Knight", "Captain", "Warden", "Mine"];

// ---------------------------------------------------------------- glyphs (viewBox 0 0 100 100, drawn in currentColor)
const G = {
  0: `<path d="M50 20c6 6 7 12 0 17c-7-5-6-11 0-17z" fill="currentColor"/><path d="M41 76l4-31h10l4 31z" fill="currentColor"/><rect x="42" y="38" width="16" height="8" rx="2" fill="currentColor"/><g stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M36 31l-8-5M64 31l8-5M34 42h-9M66 42h9"/></g><path d="M37 78h26" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
  1: `<path d="M33 73V47c0-12 8-20 17-20s17 8 17 20v26l-5.5-5-5.5 5-6-5-6 5-5.5-5z" fill="currentColor"/><circle cx="43.5" cy="47" r="4" class="hole"/><circle cx="56.5" cy="47" r="4" class="hole"/>`,
  2: `<path d="M22 50q28-26 56 0q-28 26-56 0z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><circle cx="50" cy="50" r="9" fill="currentColor"/><path d="M50 18v8M50 74v8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`,
  3: `<path d="M27 41q23-20 46 0" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M50 31v44" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M66 62l4-4 4 4-4 4zM28 66l3-3 3 3-3 3z" fill="currentColor"/>`,
  4: `<path d="M50 24l21 8v17c0 13-9 21-21 27c-12-6-21-14-21-27V32z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M50 33v34M37 46h26" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`,
  5: `<g stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M29 73l42-46M71 73L29 27"/></g><path d="M71 27l-12 1 7 9zM29 27l12 1-7 9z" fill="currentColor"/><path d="M50 43l7 7-7 7-7-7z" fill="currentColor"/>`,
  6: `<g fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M30 50l20-12 20 12"/><path d="M30 62l20-12 20 12"/><path d="M30 74l20-12 20 12"/></g><path d="M50 19l3.5 7 7.5 1-5.5 5 1.5 7.5-7-3.8-7 3.8 1.5-7.5-5.5-5 7.5-1z" fill="currentColor"/>`,
  7: `<path d="M27 68V39l12 12 11-21 11 21 12-12v29z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><rect x="27" y="71" width="46" height="7" rx="2" fill="currentColor"/><circle cx="50" cy="56" r="5" class="hole"/>`,
  8: `<g stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M50 26v8M50 70v8M26 52h8M66 52h8M33 35l6 6M61 63l6 6M67 35l-6 6M39 63l-6 6"/></g><circle cx="50" cy="52" r="15" fill="currentColor"/><circle cx="45" cy="47" r="4" class="hole" opacity=".7"/>`,
};
const HIDDEN_GLYPH = `<g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".9"><path d="M26 40q8-7 16 0t16 0t16 0"/><path d="M26 52q8-7 16 0t16 0t16 0"/><path d="M26 64q8-7 16 0t16 0t16 0"/></g>`;

// ---------------------------------------------------------------- piece skins
// side 0 = A (warm), side 1 = B (cool). Each skin draws the token body; the glyph sits on top.
const SKINS = {
  0: { name: "Fogline Standard", shape: "disc",
    side: [{ c1: "#4a3b00", c2: "#1c1600", rim: "#ffd400", glyph: "#ffd400", glow: "#ffd400" }, { c1: "#103650", c2: "#06131d", rim: "#6ec1ff", glyph: "#8fd0ff", glow: "#6ec1ff" }] },
  1: { name: "Tape Neon", shape: "square", pattern: "tape",
    side: [{ c1: "#ffd400", c2: "#e0b400", rim: "#111", glyph: "#111", glow: "#ffd400" }, { c1: "#1e1e1e", c2: "#0c0c0c", rim: "#ffd400", glyph: "#ffd400", glow: "#ffea70" }] },
  2: { name: "Candle Glow", shape: "disc", pattern: "flame",
    side: [{ c1: "#ffb347", c2: "#7a2e00", rim: "#ffe0a3", glyph: "#fff4dc", glow: "#ff9a3c" }, { c1: "#b9a3ff", c2: "#2b1a5c", rim: "#e6dcff", glyph: "#fbf8ff", glow: "#a68bff" }] },
  5: { name: "Neon Circuit", shape: "hex", pattern: "circuit",
    side: [{ c1: "#240a2e", c2: "#0b0410", rim: "#ff3df2", glyph: "#ff7af6", glow: "#ff3df2" }, { c1: "#04222a", c2: "#020b0e", rim: "#18f0ff", glyph: "#7ff8ff", glow: "#18f0ff" }] },
  6: { name: "Obsidian & Gold", shape: "shield", pattern: "filigree",
    side: [{ c1: "#2a2a2e", c2: "#050506", rim: "#e9c46a", glyph: "#f4d58d", glow: "#e9c46a", metal: true }, { c1: "#e8e4dc", c2: "#9a958c", rim: "#b8892b", glyph: "#2a2112", glow: "#ffe2a0", metal: true }] },
  7: { name: "Paper Origami", shape: "diamond", pattern: "folds",
    side: [{ c1: "#ffe9b0", c2: "#e9b949", rim: "#9c7319", glyph: "#5a3d00", glow: "#ffe9b0" }, { c1: "#cfe6ff", c2: "#7aa8d8", rim: "#2f5b8a", glyph: "#0f2a47", glow: "#cfe6ff" }] },
  8: { name: "Frost Glass", shape: "disc", pattern: "frost", glass: true,
    side: [{ c1: "rgba(255,236,180,.55)", c2: "rgba(120,90,10,.35)", rim: "#fff2c4", glyph: "#fffbe8", glow: "#ffe08a" }, { c1: "rgba(200,240,255,.55)", c2: "rgba(30,90,140,.35)", rim: "#e6fbff", glyph: "#ffffff", glow: "#a8ecff" }] },
};
export const SKIN_IDS = [0, 1, 2, 5, 6, 7, 8];

function shapePath(shape) {
  switch (shape) {
    case "square": return `<rect x="8" y="8" width="84" height="84" rx="14"/>`;
    case "hex": return `<path d="M50 5l39 22.5v45L50 95 11 72.5v-45z"/>`;
    case "shield": return `<path d="M50 5l40 12v28c0 25-17 40-40 50C27 85 10 70 10 45V17z"/>`;
    case "diamond": return `<path d="M50 4l46 46-46 46L4 50z"/>`;
    default: return `<circle cx="50" cy="50" r="44"/>`;
  }
}

function patternSVG(p, s, uid) {
  switch (p) {
    case "tape": return `<g clip-path="url(#clip${uid})" opacity=".22">${[...Array(8)].map((_, i) => `<path d="M${-40 + i * 22} 100l40-100h11l-40 100z" fill="${s.rim}"/>`).join("")}</g>`;
    case "circuit": return `<g fill="none" stroke="${s.rim}" stroke-width="1.6" opacity=".55"><path d="M18 40h14l6-6h10M82 62H66l-6 6H48M30 78l8-8h8M70 22l-8 8h-8"/><circle cx="18" cy="40" r="2.4" fill="${s.rim}"/><circle cx="82" cy="62" r="2.4" fill="${s.rim}"/><circle cx="30" cy="78" r="2" fill="${s.rim}"/><circle cx="70" cy="22" r="2" fill="${s.rim}"/></g>`;
    case "filigree": return `<g fill="none" stroke="${s.rim}" stroke-width="1.4" opacity=".7"><path d="M50 12l30 9v22c0 20-13 32-30 40C33 75 20 63 20 43V21z"/><path d="M26 24q8 10 0 20M74 24q-8 10 0 20"/></g>`;
    case "folds": return `<g opacity=".35"><path d="M50 4L50 96" stroke="${s.rim}" stroke-width="1.2"/><path d="M4 50h92" stroke="${s.rim}" stroke-width="1.2"/><path d="M50 4l46 46H50z" fill="#fff" opacity=".35"/><path d="M4 50l46 46V50z" fill="#000" opacity=".12"/></g>`;
    case "frost": return `<g stroke="#fff" stroke-width="1.2" opacity=".55" stroke-linecap="round"><path d="M22 28l8 8m-8 0l8-8M74 70l6 6m-6 0l6-6M70 20l4 4m-4 0l4-4"/><path d="M14 56q10-4 18 2M64 86q8-6 18-4" fill="none"/></g><ellipse cx="38" cy="26" rx="20" ry="8" fill="#fff" opacity=".28" transform="rotate(-25 38 26)"/>`;
    case "flame": return `<path d="M50 8c5 5 5 9 0 12c-5-3-5-7 0-12z" fill="${s.rim}" opacity=".6"/>`;
    default: return "";
  }
}

const FOGS = {
  0: { name: "Standard fog", back: (s) => ({ fill: null, glyph: HIDDEN_GLYPH, color: s.glyph }) },
  19: { name: "Ink Fog", back: () => ({ fill: "#0d0d0f", glyph: `<g fill="#f2efe6"><path d="M28 60c6-14 22-20 30-10c6 8-4 16-10 10c-4-4 2-8 5-5" fill="none" stroke="#f2efe6" stroke-width="4.5" stroke-linecap="round"/><circle cx="70" cy="34" r="4"/><circle cx="64" cy="27" r="2"/><circle cx="31" cy="72" r="2.5"/></g>`, color: "#f2efe6", rim: "#f2efe6" }) },
  20: { name: "Aurora Fog", back: () => ({ fill: "url(#aurora)", glyph: `<g fill="none" stroke="#e9fff6" stroke-width="3.5" stroke-linecap="round" opacity=".9"><path d="M24 44q13-12 26 0t26 0"/><path d="M24 58q13-12 26 0t26 0"/></g><circle cx="50" cy="72" r="3" fill="#e9fff6"/>`, color: "#e9fff6", rim: "#9dffd6", aurora: true }) },
};
export const FOG_IDS = [0, 19, 20];

let UID = 0;
/** One piece token as an SVG string. rank = null for a hidden (fogged) piece. */
export function pieceSVG({ skin = 0, rank = null, side = 0, fog = 0, size = "100%", pip = true } = {}) {
  const S = SKINS[skin] ?? SKINS[0];
  const s = S.side[side];
  const uid = `p${++UID}`;
  const hidden = rank === null;
  const fb = hidden ? (FOGS[fog] ?? FOGS[0]).back(s) : null;
  const body = shapePath(S.shape);
  const glyph = hidden ? fb.glyph : G[rank];
  const gColor = hidden ? fb.color : s.glyph;
  const rim = hidden && fb.rim ? fb.rim : s.rim;
  const fill = hidden && fb.fill ? fb.fill : `url(#g${uid})`;
  const pipTxt = !hidden && pip && rank >= 1 && rank <= 7 ? `<g><circle cx="80" cy="80" r="11" fill="${s.c2}" stroke="${rim}" stroke-width="2"/><text x="80" y="84.5" font-size="13" font-weight="800" text-anchor="middle" fill="${s.glyph}" font-family="system-ui,sans-serif">${rank}</text></g>` : "";
  return `<svg class="piece-svg" viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" style="color:${gColor}">
<defs><radialGradient id="g${uid}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${s.c1}"/><stop offset="1" stop-color="${s.c2}"/></radialGradient>
<linearGradient id="aurora" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b7f6b"/><stop offset=".5" stop-color="#3b2a8f"/><stop offset="1" stop-color="#0c3d5c"/></linearGradient>
<clipPath id="clip${uid}">${body}</clipPath>
<filter id="sh${uid}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".55"/></filter></defs>
<g filter="url(#sh${uid})"><g fill="${fill}" stroke="${rim}" stroke-width="${S.metal ? 4 : 3}">${body}</g></g>
${S.glass ? `<g clip-path="url(#clip${uid})"><rect width="100" height="40" fill="#fff" opacity=".12"/></g>` : ""}
${hidden ? "" : patternSVG(S.pattern, s, uid)}
<g style="--hole:${s.c2}">${glyph.replaceAll('class="hole"', `fill="${hidden && fb.fill ? fb.fill : s.c2}"`)}</g>${pipTxt}</svg>`;
}

export function skinGlow(skin, side) { return (SKINS[skin] ?? SKINS[0]).side[side].glow; }

// ---------------------------------------------------------------- tabletops / environments (procedural SVG backdrops)
const turb = (id, f, oct, seed, type = "fractalNoise") => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="${type}" baseFrequency="${f}" numOctaves="${oct}" seed="${seed}"/>`;
function envSVG(id) {
  const W = 1600, H = 1000;
  const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${inner}</svg>`;
  const vignette = `<defs><radialGradient id="vg" cx="50%" cy="50%" r="70%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#vg)"/>`;
  switch (id) {
    case 3: // Midnight Fog
      return wrap(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1430"/><stop offset="1" stop-color="#03060f"/></linearGradient><radialGradient id="moon" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f4f7ff"/><stop offset=".35" stop-color="#cfd9f5"/><stop offset="1" stop-color="#cfd9f5" stop-opacity="0"/></radialGradient>
${turb("fog", "0.004 0.012", 4, 7)}<feColorMatrix values="0 0 0 0 .62  0 0 0 0 .7  0 0 0 0 .86  0 0 0 1.4 -.55"/></filter>
${turb("stone", "0.02", 5, 3)}<feColorMatrix values="0 0 0 0 .1  0 0 0 0 .12  0 0 0 0 .18  0 0 0 .9 0"/></filter></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/><circle cx="1250" cy="150" r="160" fill="url(#moon)" opacity=".6"/><circle cx="1250" cy="150" r="46" fill="#eef2ff"/>
<rect y="420" width="${W}" height="580" filter="url(#stone)"/><rect width="${W}" height="${H}" filter="url(#fog)" opacity=".85"/>${vignette}`);
    case 4: // Paper Ledger
      return wrap(`<defs>${turb("pn", "0.8", 3, 11)}<feColorMatrix values="0 0 0 0 .5  0 0 0 0 .45  0 0 0 0 .35  0 0 0 .12 0"/></filter></defs>
<rect width="${W}" height="${H}" fill="#6b4a2b"/><rect x="60" y="40" width="${W - 120}" height="${H - 80}" fill="#f3ead2"/><rect x="60" y="40" width="${W - 120}" height="${H - 80}" filter="url(#pn)"/>
<g stroke="#9db89a" stroke-width="1.4" opacity=".75">${[...Array(28)].map((_, i) => `<path d="M60 ${80 + i * 32}H${W - 60}"/>`).join("")}</g>
<g stroke="#9db89a" stroke-width="1.4" opacity=".6">${[...Array(12)].map((_, i) => `<path d="M${200 + i * 110} 40V${H - 40}"/>`).join("")}</g><path d="M170 40V${H - 40}" stroke="#d86a6a" stroke-width="2.4"/>
<g transform="translate(1340 110) rotate(35)"><rect width="260" height="16" rx="8" fill="#2e3b4e"/><path d="M260 0l34 8-34 8z" fill="#e7c48c"/><rect x="-6" width="24" height="16" fill="#c99a4a"/></g>
<g transform="translate(120 820)"><circle r="60" fill="#121a2a" opacity=".9"/><circle r="42" fill="#0a0f1a"/><ellipse cx="-14" cy="-18" rx="18" ry="8" fill="#fff" opacity=".25"/></g>${vignette}`);
    case 9: // War-Room Oak
      return wrap(`<defs>${turb("wood", "0.0035 0.09", 4, 21, "turbulence")}<feColorMatrix values="0 0 0 0 .36  0 0 0 0 .2  0 0 0 0 .09  0 0 0 -1.1 1.05"/></filter>
<radialGradient id="lamp" cx="50%" cy="30%" r="65%"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
${turb("parch", "0.03", 4, 5)}<feColorMatrix values="0 0 0 0 .78  0 0 0 0 .66  0 0 0 0 .45  0 0 0 .5 .55"/></filter></defs>
<rect width="${W}" height="${H}" fill="#2a1508"/><rect width="${W}" height="${H}" filter="url(#wood)"/>
<g opacity=".92"><rect x="40" y="60" width="300" height="230" transform="rotate(-8 190 175)" filter="url(#parch)"/><rect x="1270" y="700" width="290" height="230" transform="rotate(10 1415 815)" filter="url(#parch)"/></g>
<g fill="none" stroke="#5a4020" stroke-width="2" opacity=".6"><path d="M80 140q60 30 120-10t110 30M1300 780q50-40 110 0t120-10"/></g>
<g transform="translate(1440 170)"><circle r="62" fill="#a37b2c"/><circle r="52" fill="#1b1a17"/><path d="M0-44L8 0 0 44-8 0z" fill="#d9b25a"/><path d="M-44 0L0-8 44 0 0 8z" fill="#7d6131"/></g>
<rect width="${W}" height="${H}" fill="url(#lamp)"/><g fill="#b08a3a">${[[0, 0], [W - 70, 0], [0, H - 70], [W - 70, H - 70]].map(([x, y]) => `<path d="M${x} ${y}h70v18h-52v52h-18z" transform="rotate(${x ? (y ? 180 : 90) : y ? 270 : 0} ${x + 35} ${y + 35})"/>`).join("")}</g>${vignette}`);
    case 10: { // Deep-Space Bridge
      let stars = ""; let r = 9;
      const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
      for (let i = 0; i < 260; i++) stars += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H).toFixed(0)}" r="${(rnd() * 1.8 + .3).toFixed(1)}" fill="#fff" opacity="${(rnd() * .8 + .2).toFixed(2)}"/>`;
      return wrap(`<defs>${turb("neb", "0.0025", 5, 31)}<feColorMatrix values="0 0 0 0 .45  0 0 0 0 .2  0 0 0 0 .75  0 0 0 2.2 -1"/></filter>
${turb("neb2", "0.004", 4, 77)}<feColorMatrix values="0 0 0 0 .05  0 0 0 0 .7  0 0 0 0 .85  0 0 0 2.2 -1.15"/></filter>
<radialGradient id="holo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#18f0ff" stop-opacity=".25"/><stop offset="1" stop-color="#18f0ff" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="#03030c"/><rect width="${W}" height="${H}" filter="url(#neb)"/><rect width="${W}" height="${H}" filter="url(#neb2)" opacity=".8"/>${stars}
<g fill="#0c111c" stroke="#1f3a52" stroke-width="3"><path d="M0 ${H}V720l220-90h1160l220 90v${H - 720}z"/><path d="M0 0h1600v90l-160 40H160L0 90z"/></g>
<g stroke="#18f0ff" stroke-width="3" opacity=".8"><path d="M30 760h160M1410 760h160M200 60h220M1180 60h220"/></g>
<ellipse cx="800" cy="520" rx="640" ry="420" fill="url(#holo)"/><g fill="none" stroke="#18f0ff" opacity=".35"><circle cx="800" cy="520" r="380"/><circle cx="800" cy="520" r="460" stroke-dasharray="6 14"/></g>${vignette}`);
    }
    case 11: // Misty Marsh at Dawn
      return wrap(`<defs><linearGradient id="dawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9c6a6"/><stop offset=".45" stop-color="#f6dcb7"/><stop offset=".62" stop-color="#b9c4a6"/><stop offset="1" stop-color="#4f5d45"/></linearGradient>
<radialGradient id="sun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff6d6"/><stop offset=".3" stop-color="#ffd38a" stop-opacity=".8"/><stop offset="1" stop-color="#ffd38a" stop-opacity="0"/></radialGradient>
${turb("mist", "0.003 0.02", 4, 13)}<feColorMatrix values="0 0 0 0 1  0 0 0 0 .97  0 0 0 0 .92  0 0 0 1.6 -.6"/></filter>
${turb("rock", "0.03", 5, 4)}<feColorMatrix values="0 0 0 0 .42  0 0 0 0 .44  0 0 0 0 .38  0 0 0 0 1"/></filter></defs>
<rect width="${W}" height="${H}" fill="url(#dawn)"/><circle cx="1200" cy="360" r="220" fill="url(#sun)"/>
<path d="M0 420q200-60 400-10t420-20 380 10 400-20V560H0z" fill="#7d8a72" opacity=".55"/>
<rect y="520" width="${W}" height="120" fill="#c9cfc0" opacity=".6"/>
<g stroke="#3e4a34" stroke-width="3" stroke-linecap="round" opacity=".85">${[...Array(60)].map((_, i) => { const x = (i * 97) % W, h = 60 + ((i * 37) % 90); const y = 700 + ((i * 53) % 260); return `<path d="M${x} ${y}q${(i % 5) - 2} -${h / 2} ${((i % 7) - 3) * 3} -${h}"/>`; }).join("")}</g>
<rect y="380" width="${W}" height="400" filter="url(#mist)" opacity=".9"/>
<path d="M280 980l60-200 920-20 80 220z" filter="url(#rock)" opacity=".9"/>${vignette}`);
    case 12: { // Retro Arcade CRT
      let grid = "";
      for (let i = -16; i <= 16; i++) grid += `<path d="M800 520L${800 + i * 120} ${H}"/>`;
      for (let k = 0; k < 9; k++) { const y = 520 + Math.pow(k / 8, 2) * (H - 520); grid += `<path d="M0 ${y.toFixed(0)}H${W}"/>`; }
      return wrap(`<defs><linearGradient id="syn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12002a"/><stop offset=".52" stop-color="#5a0b6b"/><stop offset=".53" stop-color="#0b0018"/><stop offset="1" stop-color="#14002a"/></linearGradient>
<linearGradient id="sunA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe15a"/><stop offset="1" stop-color="#ff2fa8"/></linearGradient>
<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000" opacity=".35"/></pattern>
<radialGradient id="crt" cx="50%" cy="50%" r="72%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".95"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#syn)"/><circle cx="800" cy="470" r="230" fill="url(#sunA)"/>
<g fill="#12002a">${[...Array(7)].map((_, i) => `<rect x="560" y="${420 + i * 22}" width="480" height="${4 + i * 1.6}"/>`).join("")}</g>
<path d="M0 520l180-120 140 80 160-150 170 190H0z" fill="#22003f" opacity=".9"/><path d="M1600 520l-200-140-150 90-170-120-160 170z" fill="#22003f" opacity=".9"/>
<g stroke="#ff3df2" stroke-width="2.2" opacity=".75">${grid}</g><g stroke="#18f0ff" stroke-width="1" opacity=".35">${grid}</g>
<rect width="${W}" height="${H}" fill="url(#scan)"/><rect width="${W}" height="${H}" fill="url(#crt)"/>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="90" fill="none" stroke="#08000f" stroke-width="40"/>`);
    }
    default: // Slate Table (free)
      return wrap(`<defs>${turb("sl", "0.012", 5, 2)}<feColorMatrix values="0 0 0 0 .16  0 0 0 0 .17  0 0 0 0 .19  0 0 0 .9 0"/></filter>
${turb("vein", "0.004 0.03", 3, 9, "turbulence")}<feColorMatrix values="0 0 0 0 .55  0 0 0 0 .56  0 0 0 0 .6  0 0 0 -6 1.1"/></filter></defs>
<rect width="${W}" height="${H}" fill="#121315"/><rect width="${W}" height="${H}" filter="url(#sl)"/><rect width="${W}" height="${H}" filter="url(#vein)" opacity=".18"/>${vignette}`);
  }
}

/** board look per tabletop: tile colours (with alpha so the backdrop shows), grid line, frame */
const TABLES = {
  0: { name: "Slate Table", light: "rgba(70,72,78,.55)", dark: "rgba(36,37,41,.65)", line: "rgba(255,255,255,.06)", frame: "#2b2c30", fogbank: "#5c6270", label: "#8a8a8a" },
  3: { name: "Midnight Fog board", light: "rgba(60,80,120,.38)", dark: "rgba(20,28,50,.55)", line: "rgba(180,200,255,.10)", frame: "#1a2442", fogbank: "#93a6d6", label: "#9fb0d8" },
  4: { name: "Paper Ledger board", light: "rgba(255,252,240,.55)", dark: "rgba(226,214,180,.55)", line: "rgba(110,140,100,.35)", frame: "#8a6a3a", fogbank: "#7f9a7c", label: "#5a4a30" },
  9: { name: "War-Room Oak", light: "rgba(196,150,90,.32)", dark: "rgba(70,40,15,.45)", line: "rgba(255,220,160,.12)", frame: "#6b4419", fogbank: "#d9c49a", label: "#e8cf9a" },
  10: { name: "Deep-Space Bridge", light: "rgba(24,240,255,.10)", dark: "rgba(5,20,40,.55)", line: "rgba(24,240,255,.35)", frame: "#18f0ff", fogbank: "#7a5cff", label: "#7ff8ff" },
  11: { name: "Misty Marsh at Dawn", light: "rgba(235,232,215,.40)", dark: "rgba(120,130,105,.45)", line: "rgba(255,255,255,.18)", frame: "#6d6a58", fogbank: "#ffffff", label: "#3e4a34" },
  12: { name: "Retro Arcade CRT", light: "rgba(255,61,242,.12)", dark: "rgba(18,0,42,.6)", line: "rgba(255,61,242,.55)", frame: "#ff3df2", fogbank: "#18f0ff", label: "#ff9af9" },
};
export const TABLE_IDS = [0, 3, 4, 9, 10, 11, 12];
export function tableStyle(id) { return TABLES[id] ?? TABLES[0]; }
const envCache = {};
export function envURL(id) {
  if (!envCache[id]) envCache[id] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(envSVG(TABLES[id] ? id : 0));
  return envCache[id];
}
export function envMarkup(id) { return envSVG(TABLES[id] ? id : 0); }

// ---------------------------------------------------------------- effects (Web Animations API, so frames can be scrubbed)
function layer(host) {
  let l = host.querySelector(":scope > .fx-layer");
  if (!l) { l = document.createElement("div"); l.className = "fx-layer"; l.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:5"; host.appendChild(l); }
  return l;
}
function centerOf(host, el) { const a = host.getBoundingClientRect(), b = el.getBoundingClientRect(); return [b.left - a.left + b.width / 2, b.top - a.top + b.height / 2, b.width]; }
function dot(l, x, y, size, color, css = "") {
  const d = document.createElement("div");
  d.style.cssText = `position:absolute;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 ${size * 1.5}px ${color};${css}`;
  l.appendChild(d); return d;
}
const done = (a, el) => a.finished.then(() => el.remove()).catch(() => {});

/** effects: id -> fn(host, cellEl, opts). id 0 = free basic effects */
export const EFFECTS = {
  basicReveal(host, cell) { const p = cell.querySelector(".piece"); p && p.animate([{ filter: "brightness(2)" }, { filter: "brightness(1)" }], { duration: 400 }); },
  basicCapture(host, cell) { const [x, y, w] = centerOf(host, cell); const l = layer(host); const r = dot(l, x, y, w, "transparent", "border:2px solid #fff;box-shadow:none"); done(r.animate([{ transform: "scale(.4)", opacity: 1 }, { transform: "scale(1.3)", opacity: 0 }], { duration: 450 }), r); },
  13(host, cell, o = {}) { // Capture Burst
    const [x, y, w] = centerOf(host, cell); const l = layer(host); const c = o.color ?? "#ffd400";
    const ring = dot(l, x, y, w * .9, "transparent", `border:3px solid ${c};box-shadow:0 0 18px ${c}, inset 0 0 18px ${c}`);
    done(ring.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(2.2)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(.2,.7,.3,1)" }), ring);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + (i % 2) * .15, dist = w * (.8 + (i % 4) * .25), s = 4 + (i % 3) * 3;
      const d = dot(l, x, y, s, i % 3 ? c : "#fff");
      done(d.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist}px) scale(.2)`, opacity: 0 }], { duration: 650 + (i % 5) * 70, easing: "cubic-bezier(.15,.8,.3,1)" }), d);
    }
    const f = dot(l, x, y, w * .7, "#fff"); done(f.animate([{ opacity: .9, transform: "scale(.5)" }, { opacity: 0, transform: "scale(1.4)" }], { duration: 300 }), f);
  },
  14(host, cell, o = {}) { // Reveal Flip & Glow
    const p = cell.querySelector(".piece"); const c = o.color ?? "#ffd400";
    if (p) p.animate([{ transform: "perspective(400px) rotateY(0deg)", filter: "drop-shadow(0 0 0 transparent)" }, { transform: "perspective(400px) rotateY(90deg) scale(1.1)", filter: `drop-shadow(0 0 14px ${c})` }, { transform: "perspective(400px) rotateY(0deg) scale(1.05)", filter: `drop-shadow(0 0 22px ${c})` }, { transform: "perspective(400px) rotateY(0deg) scale(1)", filter: "drop-shadow(0 0 0 transparent)" }], { duration: 900, easing: "ease-out" });
    const [x, y, w] = centerOf(host, cell); const l = layer(host);
    const halo = dot(l, x, y, w * 1.3, `radial-gradient(circle, ${c}88 0%, transparent 70%)`, "box-shadow:none");
    done(halo.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1.1)", offset: .45 }, { opacity: 0, transform: "scale(1.5)" }], { duration: 900 }), halo);
  },
  15(host, cell) { // Mine Blast
    const [x, y, w] = centerOf(host, cell); const l = layer(host);
    for (const [k, col, dur] of [[0, "#fff2a8", 500], [1, "#ff8a1f", 750], [2, "#ff2d2d", 950]]) {
      const r = dot(l, x, y, w, "transparent", `border:${6 - k * 2}px solid ${col};box-shadow:0 0 24px ${col}`);
      done(r.animate([{ transform: "scale(.2)", opacity: 1 }, { transform: `scale(${3 + k})`, opacity: 0 }], { duration: dur, delay: k * 60, easing: "cubic-bezier(.1,.8,.2,1)", fill: "backwards" }), r);
    }
    const core = dot(l, x, y, w * 1.4, "radial-gradient(circle,#fff 0%,#ffcf4a 30%,#ff5a1f 60%,transparent 72%)", "box-shadow:none");
    done(core.animate([{ transform: "scale(.2)", opacity: 1 }, { transform: "scale(1.6)", opacity: .9, offset: .3 }, { transform: "scale(2)", opacity: 0 }], { duration: 800 }), core);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, dist = w * (1.2 + (i % 5) * .35);
      const d = dot(l, x, y, 3 + (i % 4) * 2, i % 2 ? "#ff8a1f" : "#3a3a3a", i % 2 ? "" : "box-shadow:none;border-radius:2px");
      done(d.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist + 20}px) rotate(${i * 40}deg)`, opacity: 0 }], { duration: 900 + (i % 6) * 60, easing: "cubic-bezier(.1,.7,.4,1)" }), d);
    }
    host.animate([{ transform: "translate(0,0)" }, { transform: "translate(-6px,4px)" }, { transform: "translate(5px,-5px)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(0,0)" }], { duration: 420 });
  },
  16(host, cell, o = {}) { // Beacon Victory
    const [x, y, w] = centerOf(host, cell); const l = layer(host); const c = o.color ?? "#ffd400";
    const rays = document.createElement("div");
    rays.style.cssText = `position:absolute;left:${x - w * 5}px;top:${y - w * 5}px;width:${w * 10}px;height:${w * 10}px;border-radius:50%;background:repeating-conic-gradient(from 0deg, ${c}55 0deg 6deg, transparent 6deg 18deg);mask:radial-gradient(circle, #000 0%, transparent 65%);-webkit-mask:radial-gradient(circle, #000 0%, transparent 65%)`;
    l.appendChild(rays);
    done(rays.animate([{ transform: "scale(.2) rotate(0deg)", opacity: 0 }, { transform: "scale(1) rotate(40deg)", opacity: 1, offset: .3 }, { transform: "scale(1.1) rotate(120deg)", opacity: 0 }], { duration: 2600, easing: "ease-out" }), rays);
    const beam = document.createElement("div");
    beam.style.cssText = `position:absolute;left:${x - w * .35}px;top:${y - 900}px;width:${w * .7}px;height:900px;background:linear-gradient(to top, ${c}, ${c}00);filter:blur(4px)`;
    l.appendChild(beam);
    done(beam.animate([{ opacity: 0, transform: "scaleX(.2)" }, { opacity: .9, transform: "scaleX(1)", offset: .2 }, { opacity: 0, transform: "scaleX(.6)" }], { duration: 2200 }), beam);
    const cols = [c, "#fff", "#ff3df2", "#18f0ff", "#7dff8a"];
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + ((i % 35) / 35 - .5) * 2.6, v = w * (3 + (i % 7) * .9);
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${6 + (i % 3) * 2}px;height:${10 + (i % 4) * 2}px;background:${cols[i % 5]};border-radius:2px`;
      l.appendChild(d);
      done(d.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v}px) rotate(${i * 50}deg)`, opacity: 1, offset: .55 }, { transform: `translate(${Math.cos(a) * v * 1.15}px,${Math.sin(a) * v + w * 4}px) rotate(${i * 90}deg)`, opacity: 0 }], { duration: 2400 + (i % 9) * 80, delay: (i % 10) * 25, easing: "cubic-bezier(.2,.8,.4,1)", fill: "backwards" }), d);
    }
  },
};
export const EFFECT_IDS = [13, 14, 15, 16];

// ---------------------------------------------------------------- trails
export const TRAILS = {
  17: { name: "Ember Trail", draw(l, pts, w) { for (let i = 0; i < 14; i++) { const t = i / 13, x = pts[0][0] + (pts[1][0] - pts[0][0]) * t, y = pts[0][1] + (pts[1][1] - pts[0][1]) * t; const d = dot(l, x + ((i * 7) % 9) - 4, y + ((i * 5) % 9) - 4, 5 + (i % 3) * 2, i % 2 ? "#ff8a1f" : "#ffd36b"); done(d.animate([{ opacity: 0, transform: "translateY(0) scale(1)" }, { opacity: 1, offset: .15 }, { opacity: 0, transform: `translateY(-${w * .4}px) scale(.3)` }], { duration: 900, delay: i * 25, fill: "backwards" }), d); } } },
  18: { name: "Comet Trail", draw(l, pts, w) { const [a, b] = pts; const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; const t = document.createElement("div"); t.style.cssText = `position:absolute;left:${a[0]}px;top:${a[1] - 4}px;width:${len}px;height:8px;transform-origin:0 50%;transform:rotate(${ang}deg);background:linear-gradient(90deg,#18f0ff00,#18f0ffcc 70%,#fff);border-radius:6px;filter:blur(1px);box-shadow:0 0 16px #18f0ff`; l.appendChild(t); done(t.animate([{ opacity: 0, clipPath: "inset(0 100% 0 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)", offset: .4 }, { opacity: 0, clipPath: "inset(0 0 0 100%)" }], { duration: 800 }), t); const h = dot(l, b[0], b[1], w * .5, "#e6fdff"); done(h.animate([{ opacity: 0 }, { opacity: 1, offset: .4 }, { opacity: 0, transform: "scale(1.8)" }], { duration: 800 }), h); } },
};
export const TRAIL_IDS = [17, 18];
export function trail(host, fromEl, toEl, id) { const T = TRAILS[id]; if (!T) return; const l = layer(host); const a = centerOf(host, fromEl), b = centerOf(host, toEl); T.draw(l, [a, b], a[2]); }

// ---------------------------------------------------------------- victory banners
export const BANNERS = {
  0: { name: "Plain banner", html: (t, s) => `<div style="font:800 28px system-ui;color:#fff;background:rgba(0,0,0,.7);padding:10px 24px;border-radius:8px">${t}<div style="font-size:13px;font-weight:500;opacity:.8">${s}</div></div>` },
  21: { name: "Gilded Victory Banner", html: (t, s) => `<svg viewBox="0 0 520 150" width="440"><defs><linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#e9c46a"/><stop offset="1" stop-color="#8a6420"/></linearGradient></defs><path d="M20 40h60v70H20l22-35z" fill="#7a5418"/><path d="M500 40h-60v70h60l-22-35z" fill="#7a5418"/><rect x="60" y="22" width="400" height="92" rx="8" fill="url(#gold)" stroke="#5a3d0c" stroke-width="3"/><rect x="72" y="32" width="376" height="72" rx="5" fill="none" stroke="#fff6d0" stroke-width="1.5" opacity=".8"/><text x="260" y="76" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="40" fill="#3a2606">${t}</text><text x="260" y="98" text-anchor="middle" font-family="Georgia,serif" font-size="15" fill="#4a3410">${s}</text><path d="M260 4l7 12h-14z" fill="#e9c46a"/></svg>` },
  22: { name: "Tape Victory Banner", html: (t, s) => `<svg viewBox="0 0 560 140" width="460"><defs><pattern id="hz" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="18" height="36" fill="#111"/><rect x="18" width="18" height="36" fill="#ffd400"/></pattern></defs><g transform="rotate(-4 280 70)"><rect x="0" y="20" width="560" height="100" fill="url(#hz)"/><rect x="40" y="34" width="480" height="72" fill="#ffd400" stroke="#111" stroke-width="4"/><text x="280" y="80" text-anchor="middle" font-family="Impact,system-ui,sans-serif" font-size="44" fill="#111" letter-spacing="4">${t.toUpperCase()}</text><text x="280" y="100" text-anchor="middle" font-family="system-ui" font-weight="700" font-size="13" fill="#111">${s}</text></g></svg>` },
};
export const BANNER_IDS = [21, 22];
export function showBanner(host, id, title, sub) {
  const B = BANNERS[id] ?? BANNERS[0];
  host.querySelector(".banner")?.remove();
  const d = document.createElement("div"); d.className = "banner";
  d.style.cssText = "position:absolute;left:50%;top:13%;transform:translate(-50%,-50%);z-index:8;cursor:pointer;filter:drop-shadow(0 8px 18px rgba(0,0,0,.6))"; d.title = "click to hide"; d.onclick = () => d.remove();
  d.innerHTML = B.html(title, sub); host.appendChild(d);
  d.animate([{ transform: "translate(-50%,-50%) scale(.3) rotate(-8deg)", opacity: 0 }, { transform: "translate(-50%,-50%) scale(1.08) rotate(1deg)", opacity: 1, offset: .6 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 1 }], { duration: 700, easing: "cubic-bezier(.2,.9,.3,1.2)" });
  return d;
}
