import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative URLs make this work at both / and /<repository>/ on GitHub Pages.
  base: "./",
  plugins: [react()],
});
