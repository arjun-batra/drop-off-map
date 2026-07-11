import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Local-dev-only bridge: Vercel serverless functions (api/**) expect
 * `req.query` / `req.body` to already be parsed and a chainable
 * `res.status().json()` helper. Vite's dev server doesn't provide that, so
 * this middleware adapts plain Node req/res just enough to run the same
 * handler modules Vercel deploys, without requiring the Vercel CLI/account
 * for local iteration. Not used in production (`apply: 'serve'` only) and
 * not part of the production bundle.
 */

type HandlerModule = { default: (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown> };

const ROUTES: Record<string, () => Promise<HandlerModule>> = {
  "/config/public": () => import("../api/config/public.js"),
  "/auth/verify-password": () => import("../api/auth/verify-password.js"),
};

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function apiDevMiddleware(): Plugin {
  return {
    name: "dropspot-api-dev-middleware",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api", async (req, res, next) => {
        try {
          const url = new URL(req.url ?? "/", "http://localhost");
          const routePath = url.pathname === "" ? "/" : url.pathname;
          const loadRoute = ROUTES[routePath];
          if (!loadRoute) {
            next();
            return;
          }

          const mod = await loadRoute();

          const query: Record<string, string> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          let body: unknown;
          if (req.method && ["POST", "PUT", "PATCH"].includes(req.method)) {
            const raw = await readRequestBody(req);
            if (raw) {
              try {
                body = JSON.parse(raw);
              } catch {
                body = undefined;
              }
            }
          }

          const vercelLikeReq = Object.assign(req, { query, body });
          const vercelLikeRes = Object.assign(res as ServerResponse, {
            status(code: number) {
              res.statusCode = code;
              return vercelLikeRes;
            },
            json(payload: unknown) {
              if (!res.getHeader("Content-Type")) {
                res.setHeader("Content-Type", "application/json");
              }
              res.end(JSON.stringify(payload));
              return vercelLikeRes;
            },
          });

          await mod.default(vercelLikeReq as unknown as VercelRequest, vercelLikeRes as unknown as VercelResponse);
        } catch (err) {
          next(err as Error);
        }
      });
    },
  };
}
