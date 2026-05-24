<script setup lang="ts">
import type {
  MailAccountMailboxTree,
  MailboxAction,
  MailboxMessageSummary,
  MessageDetail,
} from "@zmail/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchAccountSyncStatus,
  fetchHealth,
  fetchMailboxTree,
  fetchMessage,
  fetchMessagesForMailbox,
  fetchSession,
  fetchUnreadMessagesForAccount,
  login,
  logout,
  performMailboxAction,
  refreshMailAccount,
  runMailAccountDiagnostics,
  searchMessagesForAccount,
} from "./api";
import { renderReadableMessage } from "./message-rendering";
import {
  mailboxPath,
  messagePath,
  parseReaderRoute,
  searchPath,
  unreadPath,
} from "./reader-routes";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

const username = ref("");
const password = ref("");
const loginError = ref("");
const showRemoteImages = ref(false);
const diagnosticsAccountId = ref("");
const mobilePane = ref<"nav" | "list" | "message">("nav");
const lastListRouteByAccount = ref(new Map<string, string>());
const searchDraft = ref("");

const healthQuery = useQuery({ queryKey: ["health"], queryFn: () => fetchHealth() });
const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });

const authenticated = computed(() => sessionQuery.data.value?.authenticated === true);

const mailboxTreeQuery = useQuery({
  queryKey: ["mailbox-tree"],
  queryFn: () => fetchMailboxTree(),
  enabled: authenticated,
});

const mailAccounts = computed(() => mailboxTreeQuery.data.value?.mailAccounts ?? []);
const readerRoute = computed(() => parseReaderRoute(route.path, route.query));
const selectedAccountId = computed(() =>
  readerRoute.value.kind === "none" ? "" : readerRoute.value.accountId,
);
const selectedAccount = computed(() =>
  mailAccounts.value.find((account) => account.id === selectedAccountId.value),
);
const selectedMessageId = computed(() =>
  readerRoute.value.kind === "none" ? "" : (readerRoute.value.messageId ?? ""),
);
const searchQuery = computed(() =>
  readerRoute.value.kind === "search" ? readerRoute.value.query : "",
);

const messageListQuery = useQuery({
  queryKey: computed(() => ["message-list", readerRoute.value]),
  queryFn: () => {
    const current = readerRoute.value;

    if (current.kind === "unread") {
      return fetchUnreadMessagesForAccount(current.accountId);
    }

    if (current.kind === "mailbox") {
      return fetchMessagesForMailbox(current.accountId, current.mailboxId);
    }

    if (current.kind === "search") {
      return searchMessagesForAccount(current.accountId, current.query);
    }

    return { messages: [] };
  },
  enabled: computed(() => authenticated.value && readerRoute.value.kind !== "none"),
});

const messages = computed(() => messageListQuery.data.value?.messages ?? []);

const messageDetailQuery = useQuery({
  queryKey: computed(() => ["message-detail", selectedAccountId.value, selectedMessageId.value]),
  queryFn: () => fetchMessage(selectedAccountId.value, selectedMessageId.value),
  enabled: computed(
    () => authenticated.value && !!selectedAccountId.value && !!selectedMessageId.value,
  ),
});

const selectedMessage = computed<MessageDetail | null>(
  () => messageDetailQuery.data.value?.message ?? null,
);

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

const diagnosticsStatusQuery = useQuery({
  queryKey: computed(() => ["sync-status", diagnosticsAccountId.value]),
  queryFn: () => fetchAccountSyncStatus(diagnosticsAccountId.value),
  enabled: computed(() => authenticated.value && !!diagnosticsAccountId.value),
});

const loginMutation = useMutation({
  mutationFn: () => login({ username: username.value, password: password.value }),
  onSuccess: async () => {
    loginError.value = "";
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["session"] }),
      queryClient.invalidateQueries({ queryKey: ["mailbox-tree"] }),
    ]);
  },
  onError: () => {
    loginError.value = "Login failed";
  },
});

const logoutMutation = useMutation({
  mutationFn: () => logout(),
  onSuccess: async () => {
    await queryClient.clear();
    await router.push("/");
  },
});

const refreshMutation = useMutation({
  mutationFn: (accountId: string) => refreshMailAccount(accountId),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["mailbox-tree"] });
    await queryClient.invalidateQueries({ queryKey: ["message-list"] });
  },
});

const diagnosticsMutation = useMutation({
  mutationFn: (accountId: string) => runMailAccountDiagnostics(accountId),
});

const mailboxActionMutation = useMutation({
  mutationFn: ({ messageId, action }: { messageId: string; action: MailboxAction }) =>
    performMailboxAction(selectedAccountId.value, messageId, action),
  onSuccess: async (_, variables) => {
    if (variables.action === "archive" || variables.action === "delete") {
      openAdjacentMessage(variables.messageId);
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mailbox-tree"] }),
      queryClient.invalidateQueries({ queryKey: ["message-list"] }),
      queryClient.invalidateQueries({ queryKey: ["message-detail"] }),
    ]);
  },
});

watch(
  () => [authenticated.value, mailAccounts.value.length, readerRoute.value.kind] as const,
  async ([isAuthenticated, accountCount, routeKind]) => {
    if (!isAuthenticated || accountCount === 0 || routeKind !== "none") {
      return;
    }

    await router.replace(unreadPath(mailAccounts.value[0].id));
  },
);

watch(
  () => route.fullPath,
  (fullPath) => {
    showRemoteImages.value = false;

    if (readerRoute.value.kind !== "none" && !readerRoute.value.messageId) {
      lastListRouteByAccount.value.set(readerRoute.value.accountId, fullPath);
    }

    searchDraft.value = readerRoute.value.kind === "search" ? readerRoute.value.query : "";
    mobilePane.value =
      readerRoute.value.kind === "none" ? "nav" : selectedMessageId.value ? "message" : "list";
  },
  { immediate: true },
);

async function submitLogin() {
  await loginMutation.mutateAsync();
}

async function selectList(path: string) {
  await router.push(path);
  mobilePane.value = "list";
}

async function selectMessage(messageId: string) {
  await router.push(messagePath(readerRoute.value, messageId, route.fullPath));
  mobilePane.value = "message";
}

async function submitSearch() {
  const query = searchDraft.value.trim();

  if (!selectedAccountId.value || !query) {
    return;
  }

  await router.push(searchPath(selectedAccountId.value, query));
}

async function clearSearch() {
  const previous = selectedAccountId.value
    ? lastListRouteByAccount.value.get(selectedAccountId.value)
    : undefined;
  await router.push(
    previous ?? (selectedAccountId.value ? unreadPath(selectedAccountId.value) : "/"),
  );
}

function openDiagnostics(accountId: string) {
  diagnosticsAccountId.value = accountId;
  diagnosticsMutation.reset();
}

async function closeDiagnostics() {
  diagnosticsAccountId.value = "";
}

function runMailboxAction(action: MailboxAction) {
  if (!selectedMessage.value) {
    return;
  }

  mailboxActionMutation.mutate({ messageId: selectedMessage.value.id, action });
}

function openAdjacentMessage(messageId: string) {
  const index = messages.value.findIndex((message) => message.id === messageId);
  const adjacent = messages.value[index + 1] ?? messages.value[index - 1];

  if (adjacent) {
    void router.replace(messagePath(readerRoute.value, adjacent.id, route.fullPath));
    return;
  }

  if (readerRoute.value.kind === "unread") {
    void router.replace(unreadPath(readerRoute.value.accountId));
  } else if (readerRoute.value.kind === "mailbox") {
    void router.replace(mailboxPath(readerRoute.value.accountId, readerRoute.value.mailboxId));
  } else if (readerRoute.value.kind === "search") {
    void router.replace(searchPath(readerRoute.value.accountId, readerRoute.value.query));
  }
}

function senderLabel(message: MailboxMessageSummary): string {
  return message.sender.displayName || message.sender.address;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function mailboxLabel(account: MailAccountMailboxTree, mailboxId: string): string {
  return account.mailboxes.find((mailbox) => mailbox.id === mailboxId)?.name ?? mailboxId;
}
</script>

<template>
  <main class="min-h-screen bg-stone-100 text-slate-950">
    <section
      v-if="!authenticated"
      class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6"
    >
      <div class="mb-8">
        <p class="text-sm font-medium text-slate-500">Zmail</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-normal">Private mail reader</h1>
        <p class="mt-3 text-sm text-slate-600">
          API {{ healthQuery.data.value?.status ?? "checking" }}
        </p>
      </div>

      <form class="space-y-4" @submit.prevent="submitLogin">
        <UFormField label="Username">
          <UInput v-model="username" autocomplete="username" name="username" size="xl" />
        </UFormField>
        <UFormField label="Password">
          <UInput
            v-model="password"
            autocomplete="current-password"
            name="password"
            size="xl"
            type="password"
          />
        </UFormField>
        <UAlert v-if="loginError" color="error" variant="soft" :title="loginError" />
        <UButton
          block
          color="neutral"
          :loading="loginMutation.isPending.value"
          size="xl"
          type="submit"
        >
          Log in
        </UButton>
      </form>
    </section>

    <section v-else class="flex h-screen min-h-0 flex-col">
      <header
        class="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-4"
      >
        <div class="min-w-0">
          <p class="text-sm font-semibold">Zmail</p>
          <p class="truncate text-xs text-slate-500">
            {{ selectedAccount?.emailAddress ?? "No mail account selected" }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UBadge color="neutral" variant="subtle">{{
            healthQuery.data.value?.status ?? "api"
          }}</UBadge>
          <UButton
            color="neutral"
            icon="i-lucide-log-out"
            square
            variant="ghost"
            aria-label="Log out"
            @click="logoutMutation.mutate()"
          />
        </div>
      </header>

      <div v-if="mailAccounts.length === 0" class="grid flex-1 place-items-center px-6 text-center">
        <div>
          <h2 class="text-xl font-semibold">No mail accounts synced yet</h2>
          <p class="mt-2 text-sm text-slate-600">
            Configure a Mail account and refresh the reader.
          </p>
        </div>
      </div>

      <div v-else class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18rem_24rem_1fr]">
        <aside
          class="min-h-0 border-r border-stone-200 bg-white"
          :class="mobilePane === 'nav' ? 'block' : 'hidden lg:block'"
          aria-label="Account mailbox tree"
        >
          <div class="flex h-full flex-col">
            <div class="border-b border-stone-200 px-4 py-3">
              <p class="text-xs font-medium uppercase text-slate-500">Accounts</p>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div v-for="account in mailAccounts" :key="account.id" class="mb-4">
                <div class="flex items-start justify-between gap-2 px-2">
                  <button
                    class="min-w-0 text-left"
                    type="button"
                    @click="selectList(unreadPath(account.id))"
                  >
                    <span class="block truncate text-sm font-semibold">{{ account.id }}</span>
                    <span class="block truncate text-xs text-slate-500">{{
                      account.emailAddress
                    }}</span>
                  </button>
                  <div class="flex shrink-0 items-center gap-1">
                    <UBadge color="neutral" size="sm" variant="subtle">{{
                      account.unreadCount
                    }}</UBadge>
                    <UButton
                      color="neutral"
                      icon="i-lucide-refresh-cw"
                      :loading="refreshMutation.isPending.value"
                      square
                      variant="ghost"
                      aria-label="Refresh account"
                      @click="refreshMutation.mutate(account.id)"
                    />
                    <UButton
                      color="neutral"
                      icon="i-lucide-circle-alert"
                      square
                      variant="ghost"
                      aria-label="Open diagnostics"
                      @click="openDiagnostics(account.id)"
                    />
                  </div>
                </div>
                <button
                  class="mt-2 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-stone-100"
                  :class="
                    readerRoute.kind === 'unread' && readerRoute.accountId === account.id
                      ? 'bg-stone-200'
                      : ''
                  "
                  type="button"
                  @click="selectList(unreadPath(account.id))"
                >
                  <span>Unread</span>
                  <UBadge color="neutral" size="sm" variant="subtle">{{
                    account.unreadCount
                  }}</UBadge>
                </button>
                <div class="mt-1 space-y-1">
                  <button
                    v-for="mailbox in account.mailboxes"
                    :key="mailbox.id"
                    class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-stone-100"
                    :class="
                      readerRoute.kind === 'mailbox' &&
                      readerRoute.accountId === account.id &&
                      readerRoute.mailboxId === mailbox.id
                        ? 'bg-stone-200'
                        : ''
                    "
                    type="button"
                    @click="selectList(mailboxPath(account.id, mailbox.id))"
                  >
                    <span class="truncate">{{ mailbox.name }}</span>
                    <UBadge color="neutral" size="sm" variant="subtle">{{
                      mailbox.unreadCount
                    }}</UBadge>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section
          class="min-h-0 border-r border-stone-200 bg-stone-50"
          :class="mobilePane === 'list' ? 'block' : 'hidden lg:block'"
          aria-label="Message list"
        >
          <div class="flex h-full flex-col">
            <div class="space-y-3 border-b border-stone-200 bg-white p-3">
              <div class="flex items-center gap-2 lg:hidden">
                <UButton
                  color="neutral"
                  icon="i-lucide-menu"
                  square
                  variant="ghost"
                  @click="mobilePane = 'nav'"
                />
                <span class="text-sm font-medium">Messages</span>
              </div>
              <form class="flex gap-2" @submit.prevent="submitSearch">
                <UInput
                  v-model="searchDraft"
                  class="min-w-0 flex-1"
                  icon="i-lucide-search"
                  placeholder="Search this account"
                />
                <UButton color="neutral" type="submit">Search</UButton>
                <UButton
                  v-if="readerRoute.kind === 'search'"
                  color="neutral"
                  icon="i-lucide-x"
                  square
                  variant="ghost"
                  aria-label="Clear search"
                  @click="clearSearch"
                />
              </form>
              <p class="truncate text-xs text-slate-500">
                <template v-if="readerRoute.kind === 'unread'">Unread Messages</template>
                <template v-else-if="readerRoute.kind === 'mailbox' && selectedAccount">
                  {{ mailboxLabel(selectedAccount, readerRoute.mailboxId) }}
                </template>
                <template v-else-if="readerRoute.kind === 'search'"
                  >Search results for "{{ readerRoute.query }}"</template
                >
              </p>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div v-if="messageListQuery.isLoading.value" class="p-4 text-sm text-slate-500">
                Loading messages...
              </div>
              <UAlert
                v-else-if="messageListQuery.isError.value"
                class="m-3"
                color="error"
                variant="soft"
                title="Messages unavailable"
              />
              <div v-else-if="messages.length === 0" class="p-6 text-sm text-slate-500">
                No messages in this view.
              </div>
              <button
                v-for="message in messages"
                v-else
                :key="message.id"
                class="block w-full border-b border-stone-200 bg-white px-4 py-3 text-left hover:bg-stone-50"
                :class="selectedMessageId === message.id ? 'bg-stone-100' : ''"
                type="button"
                @click="selectMessage(message.id)"
              >
                <div class="flex items-center justify-between gap-3">
                  <span
                    class="truncate text-sm"
                    :class="message.unread ? 'font-semibold' : 'font-medium'"
                  >
                    {{ senderLabel(message) }}
                  </span>
                  <span class="shrink-0 text-xs text-slate-500">{{
                    formatDate(message.receivedAt)
                  }}</span>
                </div>
                <p class="mt-1 truncate text-sm" :class="message.unread ? 'font-semibold' : ''">
                  {{ message.subject || "(No subject)" }}
                </p>
                <p class="mt-1 line-clamp-2 text-xs text-slate-500">{{ message.snippet }}</p>
              </button>
            </div>
          </div>
        </section>

        <article
          class="min-h-0 bg-white"
          :class="mobilePane === 'message' ? 'block' : 'hidden lg:block'"
          aria-label="Message content"
        >
          <div class="flex h-full flex-col">
            <div class="flex h-12 shrink-0 items-center gap-2 border-b border-stone-200 px-3">
              <UButton
                class="lg:hidden"
                color="neutral"
                icon="i-lucide-arrow-left"
                square
                variant="ghost"
                @click="mobilePane = 'list'"
              />
              <template v-if="selectedMessage">
                <UButton
                  color="neutral"
                  :icon="selectedMessage.unread ? 'i-lucide-mail-open' : 'i-lucide-mail'"
                  :loading="mailboxActionMutation.isPending.value"
                  variant="ghost"
                  @click="runMailboxAction(selectedMessage.unread ? 'markRead' : 'markUnread')"
                >
                  {{ selectedMessage.unread ? "Mark read" : "Mark unread" }}
                </UButton>
                <UButton
                  color="neutral"
                  icon="i-lucide-archive"
                  variant="ghost"
                  @click="runMailboxAction('archive')"
                >
                  Archive
                </UButton>
                <UButton
                  color="neutral"
                  icon="i-lucide-trash-2"
                  variant="ghost"
                  @click="runMailboxAction('delete')"
                >
                  Delete
                </UButton>
                <UButton
                  color="neutral"
                  :icon="selectedMessage.starred ? 'i-lucide-star-off' : 'i-lucide-star'"
                  variant="ghost"
                  @click="runMailboxAction(selectedMessage.starred ? 'unstar' : 'star')"
                >
                  {{ selectedMessage.starred ? "Unstar" : "Star" }}
                </UButton>
              </template>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div v-if="messageDetailQuery.isLoading.value" class="p-6 text-sm text-slate-500">
                Loading message...
              </div>
              <div
                v-else-if="!selectedMessage"
                class="grid h-full place-items-center p-6 text-center text-sm text-slate-500"
              >
                Select a Message to read.
              </div>
              <div v-else-if="renderedMessage" class="mx-auto max-w-4xl px-5 py-6">
                <h1 class="text-2xl font-semibold tracking-normal">
                  {{ selectedMessage.subject || "(No subject)" }}
                </h1>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>{{ senderLabel(selectedMessage) }}</span>
                  <span>{{ selectedMessage.sender.address }}</span>
                  <span>{{ formatDate(selectedMessage.receivedAt) }}</span>
                </div>
                <UAlert
                  v-if="renderedMessage.blockedRemoteImageCount && !showRemoteImages"
                  class="mt-4"
                  color="warning"
                  variant="soft"
                  title="Remote images are blocked"
                  :description="`${renderedMessage.blockedRemoteImageCount} remote image(s) blocked for privacy.`"
                >
                  <template #actions>
                    <UButton color="neutral" size="sm" @click="showRemoteImages = true"
                      >Show images</UButton
                    >
                  </template>
                </UAlert>
                <div class="message-body mt-6" v-html="renderedMessage.html"></div>
                <div
                  v-if="selectedMessage.attachments.length"
                  class="mt-6 border-t border-stone-200 pt-4"
                >
                  <h2 class="text-sm font-semibold">Attachments</h2>
                  <ul class="mt-2 space-y-2">
                    <li
                      v-for="attachment in selectedMessage.attachments"
                      :key="attachment.id"
                      class="rounded-md border border-stone-200 px-3 py-2 text-sm"
                    >
                      {{ attachment.filename }} · {{ attachment.mimeType }} ·
                      {{ attachment.sizeBytes }} bytes
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <UModal :open="!!diagnosticsAccountId" @update:open="closeDiagnostics">
      <template #content>
        <div class="space-y-4 p-5">
          <div>
            <h2 class="text-lg font-semibold">Mail account diagnostics</h2>
            <p class="mt-1 text-sm text-slate-500">{{ diagnosticsAccountId }}</p>
          </div>
          <div class="rounded-md border border-stone-200 p-3 text-sm">
            <p>Status: {{ diagnosticsStatusQuery.data.value?.syncStatus ?? "unknown" }}</p>
            <p v-if="diagnosticsStatusQuery.data.value?.lastSyncFinishedAt">
              Last sync: {{ diagnosticsStatusQuery.data.value.lastSyncFinishedAt }}
            </p>
            <p v-if="diagnosticsStatusQuery.data.value?.lastError" class="text-red-600">
              {{ diagnosticsStatusQuery.data.value.lastError }}
            </p>
          </div>
          <UAlert
            v-if="diagnosticsMutation.data.value?.success === true"
            color="success"
            variant="soft"
            title="Diagnostics passed"
            :description="`${diagnosticsMutation.data.value.visibleMailboxCount} visible mailboxes found.`"
          />
          <UAlert
            v-if="diagnosticsMutation.data.value?.success === false"
            color="error"
            variant="soft"
            title="Diagnostics failed"
            :description="diagnosticsMutation.data.value.lastError"
          />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="closeDiagnostics">Close</UButton>
            <UButton
              color="neutral"
              :loading="diagnosticsMutation.isPending.value"
              @click="diagnosticsMutation.mutate(diagnosticsAccountId)"
            >
              Run diagnostics
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </main>
</template>
