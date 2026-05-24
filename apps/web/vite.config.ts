import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [vue(), ui()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
