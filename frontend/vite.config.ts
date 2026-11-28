import net from "node:net";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host });
    sock.setTimeout(250);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function resolveProxyTarget(): Promise<string> {
  if (process.env.VITE_PROXY_TARGET) return process.env.VITE_PROXY_TARGET;
  if (await isPortOpen(8080)) return "http://127.0.0.1:8080";
  if (await isPortOpen(8000)) return "http://127.0.0.1:8000";
  return "http://127.0.0.1:8080";
}

export default defineConfig(async () => {
  const proxyTarget = await resolveProxyTarget();
  const wsTarget = proxyTarget.replace(/^http/, "ws");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("error", (_err, _req, res) => {
              if ("writeHead" in res && !res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    detail: `Backend unreachable at ${proxyTarget}. Start Docker (:8080) or run 'uvicorn app.main:app --port 8000' in backend/.`,
                  })
                );
              }
            });
          },
        },
        "/ws": {
          target: wsTarget,
          ws: true,
        },
        "/health": {
          target: proxyTarget,
        },
      },
    },
  };
});
