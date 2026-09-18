import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  pathname: string;
  search: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Array<string | Uint8Array>;
}

export interface FakeXaiServer {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeXai(
  reply: (request: RecordedRequest) => FakeReply | Promise<FakeReply>,
): Promise<FakeXaiServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const url = new URL(req.url ?? "/", "http://fake.invalid");
      const recorded: RecordedRequest = {
        method: req.method ?? "GET",
        pathname: url.pathname,
        search: url.search,
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      const output = await reply(recorded);
      res.writeHead(output.status ?? 200, output.headers ?? {});
      for (const chunk of output.chunks ?? []) res.write(chunk);
      res.end();
    } catch (error) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
