import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` serves the UI on :5173 and forwards API calls to a running
// Calavera backend (set CALAVERA_API to its address).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": process.env.CALAVERA_API ?? "http://127.0.0.1:8080" },
  },
});
