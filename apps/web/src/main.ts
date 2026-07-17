import { createApp, h } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { createEphemeralMailState } from "./live-mail-memory";
import "./assets/main.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/:pathMatch(.*)*",
      component: App,
    },
  ],
});

createApp({ render: () => h(App) })
  .use(router)
  .use(VueQueryPlugin, { queryClient: createEphemeralMailState() })
  .mount("#app");
