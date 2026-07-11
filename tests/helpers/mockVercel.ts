import type { VercelRequest, VercelResponse } from "@vercel/node";

export interface MockRes {
  req: VercelRequest;
  res: VercelResponse;
  statusCode(): number | undefined;
  jsonBody(): unknown;
  header(name: string): string | undefined;
}

interface MockReqInit {
  method?: string;
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
}

/**
 * Minimal Vercel-shaped req/res mock so api/**.ts handlers can be invoked
 * directly in tests without an HTTP server or the Vercel CLI, matching how
 * the dev-only Vite middleware bridges the same handlers locally.
 */
export function createMock(init: MockReqInit = {}): MockRes {
  let statusCode: number | undefined;
  let jsonBody: unknown;
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;

  const req = {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    query: {},
  } as unknown as VercelRequest;

  const res = {
    setHeader(name: string, value: string) {
      headers[`__out_${name}`] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      jsonBody = payload;
      return res;
    },
  } as unknown as VercelResponse;

  return {
    req,
    res,
    statusCode: () => statusCode,
    jsonBody: () => jsonBody,
    header: (name: string) => headers[`__out_${name}`],
  };
}
