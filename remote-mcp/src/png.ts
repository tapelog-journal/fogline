// SVG -> PNG inside the Worker with resvg (WebAssembly). Fonts are bundled (Inter, SIL OFL), no system fonts.
// @ts-ignore wasm module (wrangler CompiledWasm)
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
// @ts-ignore binary data module (wrangler Data rule)
import inter500 from "../assets/inter-500.ttf";
// @ts-ignore binary data module (wrangler Data rule)
import inter800 from "../assets/inter-800.ttf";

let ready: Promise<void> | undefined;
const fonts = () => [new Uint8Array(inter500 as ArrayBuffer), new Uint8Array(inter800 as ArrayBuffer)];

export async function svgToPng(svg: string, width?: number): Promise<Uint8Array> {
  if (!ready) ready = initWasm(wasm as WebAssembly.Module).catch((e) => { ready = undefined; throw e; });
  await ready;
  const r = new Resvg(svg, {
    font: { fontBuffers: fonts(), defaultFontFamily: "Inter", sansSerifFamily: "Inter", serifFamily: "Inter", monospaceFamily: "Inter", cursiveFamily: "Inter", fantasyFamily: "Inter" } as any,
    fitTo: width ? { mode: "width", value: width } : { mode: "original" },
  });
  try {
    const img = r.render();
    try { return img.asPng(); } finally { img.free(); }
  } finally { r.free(); }
}

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
