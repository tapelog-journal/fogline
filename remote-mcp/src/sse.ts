// Legacy HTTP+SSE MCP transport (GET /sse + POST /messages?sessionId=...), one Durable Object per
// SSE connection so the event stream and the POSTed messages meet in the same place.
import { DurableObject } from "cloudflare:workers";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./tools";
import type { Env } from "./env";

class DOSseTransport implements Transport {
  onclose?: () => void; onerror?: (e: Error) => void; onmessage?: (m: JSONRPCMessage) => void;
  sessionId?: string;
  constructor(private write: (s: string) => Promise<void>) {}
  async start() {}
  async send(m: JSONRPCMessage) { await this.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`); }
  async close() { this.onclose?.(); }
}

export class SseSession extends DurableObject<Env> {
  private transport?: DOSseTransport;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private ping?: ReturnType<typeof setInterval>;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const sid = url.searchParams.get("sessionId")!;
    if (req.method === "GET") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter(), enc = new TextEncoder();
      this.writer = writer;
      const write = async (s: string) => { try { await writer.write(enc.encode(s)); } catch { this.cleanup(); } };
      this.transport = new DOSseTransport(write);
      this.transport.sessionId = sid;
      const server = buildServer(this.env, req.headers.get("cf-connecting-ip") ?? "unknown");
      await server.connect(this.transport);
      void write(`event: endpoint\ndata: /messages?sessionId=${sid}\n\n`); // do not await: the stream is not being read until we return
      this.ping = setInterval(() => void write(`: ping\n\n`), 15_000);
      return new Response(readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" } });
    }
    if (req.method === "POST") {
      if (!this.transport) return new Response("SSE session not found or expired; reconnect to /sse", { status: 404 });
      let msg: JSONRPCMessage;
      try { msg = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
      const t = this.transport;
      // process in the background; replies flow over the SSE stream
      this.ctx.waitUntil(Promise.resolve().then(() => t.onmessage?.(msg)));
      return new Response("Accepted", { status: 202, headers: { "access-control-allow-origin": "*" } });
    }
    return new Response("method not allowed", { status: 405 });
  }

  private cleanup() {
    if (this.ping) clearInterval(this.ping);
    this.transport?.onclose?.();
    this.transport = undefined; this.writer = undefined;
  }
}
