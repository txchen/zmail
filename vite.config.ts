import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    throw new Error("This repo has no root Vite app. Use `vp run dev` to start Zmail.");
  }

  return {
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
  };
});
