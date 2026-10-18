import type { NonceStore } from "./chain";
export function nonceStore(storage: DurableObjectStorage, key = "nonce"): NonceStore {
  return { get: () => storage.get<number>(key), set: (n) => storage.put(key, n) };
}
export const utcDay = () => new Date().toISOString().slice(0, 10);
export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Serialize async sections inside one Durable Object instance (nonce safety). */
export class Mutex {
  private p: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.p.then(fn, fn);
    this.p = r.catch(() => undefined);
    return r;
  }
}
