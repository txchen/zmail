<script setup lang="ts">
import type { MailAccountSummary } from "@zmail/shared";
import { onMounted, ref } from "vue";
import { fetchHealth, fetchMailAccounts, login } from "./api";
import type { HealthStatus } from "@zmail/shared";

const health = ref<HealthStatus | null>(null);
const username = ref("");
const password = ref("");
const loginError = ref("");
const mailAccounts = ref<MailAccountSummary[]>([]);

onMounted(async () => {
  health.value = await fetchHealth();
});

async function submitLogin() {
  loginError.value = "";

  try {
    await login({ username: username.value, password: password.value });
    mailAccounts.value = (await fetchMailAccounts()).mailAccounts;
  } catch {
    loginError.value = "Login failed";
  }
}
</script>

<template>
  <main>
    <h1>Zmail</h1>
    <p v-if="health">API {{ health.status }}</p>
    <p v-else>Checking API...</p>

    <form @submit.prevent="submitLogin">
      <label>
        Username
        <input v-model="username" autocomplete="username" name="username" />
      </label>
      <label>
        Password
        <input v-model="password" autocomplete="current-password" name="password" type="password" />
      </label>
      <button type="submit">Log in</button>
      <p v-if="loginError">{{ loginError }}</p>
    </form>

    <ul>
      <li v-for="account in mailAccounts" :key="account.id">
        {{ account.displayName }} ({{ account.emailAddress }})
      </li>
    </ul>
  </main>
</template>
