<script setup lang="ts">
import type { HealthStatus } from "@zmail/shared";
import type {
  MailAccountMailboxTree,
  MailboxAction,
  MailboxMessageSummary,
  MessageDetail,
} from "@zmail/shared";
import { computed, onMounted, ref } from "vue";
import {
  fetchHealth,
  fetchMailboxTree,
  fetchMessage,
  fetchMessagesForMailbox,
  login,
  performMailboxAction,
  refreshMailAccount,
} from "./api";
import { renderReadableMessage } from "./message-rendering";

const health = ref<HealthStatus | null>(null);
const username = ref("");
const password = ref("");
const loginError = ref("");
const mailAccounts = ref<MailAccountMailboxTree[]>([]);
const selectedMailAccountId = ref("");
const selectedMailboxId = ref("");
const messages = ref<MailboxMessageSummary[]>([]);
const selectedMessage = ref<MessageDetail | null>(null);
const showRemoteImages = ref(false);
const mailboxActionError = ref("");

const renderedMessage = computed(() => {
  if (!selectedMessage.value) {
    return null;
  }

  return renderReadableMessage({
    readableBody: selectedMessage.value.readableBody,
    plainTextBody: selectedMessage.value.plainTextBody,
    showRemoteImages: showRemoteImages.value,
  });
});

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

async function selectMailbox(mailAccountId: string, mailboxId: string) {
  selectedMailAccountId.value = mailAccountId;
  selectedMailboxId.value = mailboxId;
  selectedMessage.value = null;
  showRemoteImages.value = false;
  messages.value = (await fetchMessagesForMailbox(mailAccountId, mailboxId)).messages;
}

async function selectMessage(messageId: string) {
  selectedMessage.value = (await fetchMessage(selectedMailAccountId.value, messageId)).message;
  showRemoteImages.value = false;
  mailboxActionError.value = "";
}

async function runMailboxAction(action: MailboxAction) {
  if (!selectedMessage.value) {
    return;
  }

  mailboxActionError.value = "";

  try {
    selectedMessage.value = (
      await performMailboxAction(selectedMailAccountId.value, selectedMessage.value.id, action)
    ).message;
    if (selectedMailboxId.value) {
      messages.value = (
        await fetchMessagesForMailbox(selectedMailAccountId.value, selectedMailboxId.value)
      ).messages;
    }
  } catch {
    mailboxActionError.value = "Mailbox action failed";
  }
}
</script>

<template>
  <main class="reader">
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

    <section class="reader-columns">
      <aside aria-label="Account mailbox tree">
        <ul>
          <li v-for="account in mailAccounts" :key="account.id">
            <div>
              {{ account.displayName }} ({{ account.unreadCount }})
              <button type="button" @click="refreshAccount(account.id)">Refresh</button>
            </div>
            <div>{{ account.syncStatus }}</div>
            <ul>
              <li v-for="mailbox in account.mailboxes" :key="mailbox.id">
                <button type="button" @click="selectMailbox(account.id, mailbox.id)">
                  {{ mailbox.name }} ({{ mailbox.unreadCount }})
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </aside>

      <section aria-label="Message list">
        <button
          v-for="message in messages"
          :key="message.id"
          type="button"
          @click="selectMessage(message.id)"
        >
          <strong>{{ message.subject }}</strong>
          <span>{{ message.receivedAt }}</span>
          <span v-if="message.attachments.length"
            >Attachments {{ message.attachments.length }}</span
          >
        </button>
      </section>

      <article aria-label="Message content">
        <template v-if="selectedMessage && renderedMessage">
          <h2>{{ selectedMessage.subject }}</h2>
          <div>
            <button
              type="button"
              @click="runMailboxAction(selectedMessage.unread ? 'markRead' : 'markUnread')"
            >
              {{ selectedMessage.unread ? "Mark read" : "Mark unread" }}
            </button>
            <button type="button" @click="runMailboxAction('archive')">Archive</button>
            <button type="button" @click="runMailboxAction('delete')">Delete</button>
            <button
              type="button"
              @click="runMailboxAction(selectedMessage.starred ? 'unstar' : 'star')"
            >
              {{ selectedMessage.starred ? "Unstar" : "Star" }}
            </button>
          </div>
          <p v-if="mailboxActionError">{{ mailboxActionError }}</p>
          <button
            v-if="renderedMessage.blockedRemoteImageCount && !showRemoteImages"
            type="button"
            @click="showRemoteImages = true"
          >
            Show remote images
          </button>
          <div v-html="renderedMessage.html"></div>
          <ul v-if="selectedMessage.attachments.length">
            <li v-for="attachment in selectedMessage.attachments" :key="attachment.id">
              {{ attachment.filename }} {{ attachment.mimeType }} {{ attachment.sizeBytes }}
            </li>
          </ul>
        </template>
      </article>
    </section>
  </main>
</template>

<style scoped>
.reader-columns {
  display: grid;
  grid-template-columns: minmax(12rem, 18rem) minmax(16rem, 24rem) minmax(20rem, 1fr);
  gap: 1rem;
}
</style>
