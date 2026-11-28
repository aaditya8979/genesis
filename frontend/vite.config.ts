import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8080";
const wsTarget = proxyTarget.replace(/^http/, "ws");

export default defineConfig({
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
                  detail: `Exchange backend unreachable at ${proxyTarget}. Start Docker stack (:8080) or pass ?api=https://your-ec2-domain`,
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
});

