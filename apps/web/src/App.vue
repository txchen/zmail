<script setup lang="ts">
import type { MailAccountMailboxTree } from "@zmail/shared";
import { onMounted, ref } from "vue";
import { fetchHealth, fetchMailboxTree, login, refreshMailAccount } from "./api";
import type { HealthStatus } from "@zmail/shared";

const health = ref<HealthStatus | null>(null);
const username = ref("");
const password = ref("");
const loginError = ref("");
const mailAccounts = ref<MailAccountMailboxTree[]>([]);

onMounted(async () => {
  health.value = await fetchHealth();
});

async function submitLogin() {
  loginError.value = "";

  try {
    await login({ username: username.value, password: password.value });
    mailAccounts.value = (await fetchMailboxTree()).mailAccounts;
  } catch {
    loginError.value = "Login failed";
  }
}

async function refreshAccount(mailAccountId: string) {
  mailAccounts.value = (await refreshMailAccount(mailAccountId)).mailAccounts;
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
        <div>
          {{ account.displayName }} ({{ account.unreadCount }})
          <button type="button" @click="refreshAccount(account.id)">Refresh</button>
        </div>
        <div>{{ account.syncStatus }}</div>
        <ul>
          <li v-for="mailbox in account.mailboxes" :key="mailbox.id">
            {{ mailbox.name }} ({{ mailbox.unreadCount }})
          </li>
        </ul>
      </li>
    </ul>
  </main>
</template>
