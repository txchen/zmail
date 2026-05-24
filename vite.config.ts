import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  fmt: {
    ignorePatterns: ["AGENTS.md", ".agents/**", "node_modules/**", "dist/**"],
  },
  lint: {
    ignorePatterns: ["AGENTS.md", ".agents/**", "node_modules/**", "dist/**"],
  },
});
