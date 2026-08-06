import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ingen proxier her længere — og det er med vilje.
//
// Tidligere lå der proxier til TED, CVR og Erhvervsstyrelsens regnskabsdata i
// denne fil. De virkede kun i `vite dev` og `vite preview`, hvilket betød at
// en bygget app ikke kunne hostes nogen steder: proxierne fandtes ikke i
// produktion, så alle live-kald ville fejle.
//
// De fire kilder kaldes nu gennem Supabase Edge Functions (se
// supabase/functions/ og src/lib/apiClient.js) — ad samme vej i udvikling og
// produktion. Genindfør ikke en dev-only proxy her; det var netop forskellen
// mellem de to miljøer der var problemet.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000
  }
});
