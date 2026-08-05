import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Live-kilder kaldes gennem lokale proxier, fordi:
// - TED (api.ted.europa.eu) sender ingen Access-Control-Allow-Origin header,
//   så browseren blokerer direkte kald.
// - cvrapi.dk kræver en custom User-Agent header (ellers INVALID_UA) — det er
//   en "forbidden header" browsere ikke må sætte selv, så den skal sættes
//   server-side i proxyen.
// - distribution.virk.dk / regnskaber.virk.dk (Erhvervsstyrelsens regnskabsdata)
//   er kun http:// — en https-serveret app kan ikke kalde dem direkte
//   (mixed content), og de svarer langsomt, derfor en høj proxy-timeout.
const apiProxy = {
  "/api/ted": {
    target: "https://api.ted.europa.eu",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ted/, "")
  },
  "/api/cvr": {
    target: "https://cvrapi.dk",
    changeOrigin: true,
    // Client calls /api/cvr/api?... (see cvrService.js) — strip only the
    // "/api/cvr" prefix so "/api?..." reaches cvrapi.dk, not "/api/api?...".
    rewrite: (path) => path.replace(/^\/api\/cvr/, ""),
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("User-Agent", "MarkedsanalysePlatform - demo@markedsanalyse.dk");
      });
    }
  },
  "/api/regnskab-search": {
    target: "http://distribution.virk.dk",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/regnskab-search/, "/offentliggoerelser/_search"),
    timeout: 120000,
    proxyTimeout: 120000
  },
  "/api/regnskab-doc": {
    target: "http://regnskaber.virk.dk",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/regnskab-doc/, ""),
    timeout: 120000,
    proxyTimeout: 120000
  }
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: apiProxy
  },
  preview: {
    proxy: apiProxy
  }
});
