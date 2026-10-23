import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The homepage imports ../results/metrics.json, which lives outside this folder.
export default defineConfig({ plugins: [react()], server: { fs: { allow: [".."] } } });
