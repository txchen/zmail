<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchHealth } from "./api";
import type { HealthStatus } from "@zmail/shared";

const health = ref<HealthStatus | null>(null);

onMounted(async () => {
  health.value = await fetchHealth();
});
</script>

<template>
  <main>
    <h1>Zmail</h1>
    <p v-if="health">API {{ health.status }}</p>
    <p v-else>Checking API...</p>
  </main>
</template>
