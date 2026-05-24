<script setup lang="ts">
import type {
  MailAccountMailboxTree,
  MailboxAction,
  MailboxMessageSummary,
  MailboxSummary,
  MessageDetail,
} from "@zmail/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, ref, watch } from "vue";
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
import { accountSyncStatusLabel } from "./reader-presenters";
import {
  defaultReaderPath,
  mailboxPath,
  messagePath,
  nextMessagePathAfterRemoval,
  parseReaderRoute,
  searchPath,
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
const loggedOut = ref(false);
const collapsedAccounts = ref(new Set<string>());
const collapsedMailboxGroups = ref(new Set<string>());
const readerLayoutStorageKey = "zmail.readerLayout.v1";
const savedReaderLayout = readSavedReaderLayout();
const navColumnWidth = ref(savedReaderLayout.navColumnWidth);
const listColumnWidth = ref(savedReaderLayout.listColumnWidth);
const activeResize = ref<"nav" | "list" | null>(null);
let resizeStartX = 0;
let resizeStartWidth = 0;

type MailboxTreeNode = {
  id: string;
  label: string;
  mailbox?: MailboxSummary;
  children: MailboxTreeNode[];
  unreadCount: number;
};

type VisibleMailboxRow = {
  key: string;
  id: string;
  label: string;
  depth: number;
  mailbox?: MailboxSummary;
  hasChildren: boolean;
  collapsed: boolean;
  unreadCount: number;
};

const healthQuery = useQuery({ queryKey: ["health"], queryFn: () => fetchHealth() });
const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });

const authenticated = computed(
  () => !loggedOut.value && sessionQuery.data.value?.authenticated === true,
);

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
const readerGridStyle = computed(() => ({
  "--reader-nav-width": `${navColumnWidth.value}px`,
  "--reader-list-width": `${listColumnWidth.value}px`,
}));

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
    accountId: selectedMessage.value.accountId,
    messageId: selectedMessage.value.id,
    readableBody: selectedMessage.value.readableBody,
    plainTextBody: selectedMessage.value.plainTextBody,
    inlineResources: selectedMessage.value.inlineResources,
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
    loggedOut.value = false;
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
    loggedOut.value = true;
    queryClient.clear();
    queryClient.setQueryData(["session"], { authenticated: false });
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

    const path = defaultReaderPath(mailAccounts.value);
    if (path) {
      await router.replace(path);
    }
  },
);

watch(
  () => route.fullPath,
  (fullPath) => {
    showRemoteImages.value = false;

    if (
      (readerRoute.value.kind === "unread" || readerRoute.value.kind === "mailbox") &&
      !readerRoute.value.messageId
    ) {
      lastListRouteByAccount.value.set(readerRoute.value.accountId, fullPath);
    }

    searchDraft.value = readerRoute.value.kind === "search" ? readerRoute.value.query : "";
    mobilePane.value =
      readerRoute.value.kind === "none" ? "nav" : selectedMessageId.value ? "message" : "list";
  },
  { immediate: true },
);

watch([navColumnWidth, listColumnWidth], ([nextNavWidth, nextListWidth]) => {
  localStorage.setItem(
    readerLayoutStorageKey,
    JSON.stringify({
      navColumnWidth: nextNavWidth,
      listColumnWidth: nextListWidth,
    }),
  );
});

onBeforeUnmount(() => {
  stopColumnResize();
});

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
  const fallback = selectedAccount.value ? defaultReaderPath([selectedAccount.value]) : undefined;
  await router.push(previous ?? fallback ?? "/");
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
  void router.replace(
    nextMessagePathAfterRemoval(readerRoute.value, messageId, messages.value, route.fullPath),
  );
}

function accountCollapsed(accountId: string): boolean {
  return collapsedAccounts.value.has(accountId);
}

function toggleAccount(accountId: string) {
  collapsedAccounts.value = toggledSet(collapsedAccounts.value, accountId);
}

function mailboxGroupKey(accountId: string, mailboxId: string): string {
  return `${accountId}:${mailboxId}`;
}

function mailboxGroupCollapsed(accountId: string, mailboxId: string): boolean {
  return collapsedMailboxGroups.value.has(mailboxGroupKey(accountId, mailboxId));
}

function toggleMailboxGroup(accountId: string, mailboxId: string) {
  collapsedMailboxGroups.value = toggledSet(
    collapsedMailboxGroups.value,
    mailboxGroupKey(accountId, mailboxId),
  );
}

function toggledSet(source: Set<string>, value: string): Set<string> {
  const next = new Set(source);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function visibleMailboxRows(account: MailAccountMailboxTree): VisibleMailboxRow[] {
  const roots = buildMailboxTree(account.mailboxes);
  const rows: VisibleMailboxRow[] = [];

  for (const node of roots) {
    appendMailboxRows(account.id, node, 0, rows);
  }

  return rows;
}

function appendMailboxRows(
  accountId: string,
  node: MailboxTreeNode,
  depth: number,
  rows: VisibleMailboxRow[],
) {
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && mailboxGroupCollapsed(accountId, node.id);

  rows.push({
    key: mailboxGroupKey(accountId, node.id),
    id: node.id,
    label: node.label,
    depth,
    mailbox: node.mailbox,
    hasChildren,
    collapsed,
    unreadCount: node.unreadCount,
  });

  if (collapsed) {
    return;
  }

  for (const child of node.children) {
    appendMailboxRows(accountId, child, depth + 1, rows);
  }
}

function buildMailboxTree(mailboxes: MailboxSummary[]): MailboxTreeNode[] {
  const roots: MailboxTreeNode[] = [];
  const nodes = new Map<string, MailboxTreeNode>();

  for (const mailbox of mailboxes) {
    const parts = mailbox.id.split("/").filter(Boolean);
    let path = "";
    let siblings = roots;

    for (const [index, part] of parts.entries()) {
      path = path ? `${path}/${part}` : part;
      let node = nodes.get(path);

      if (!node) {
        node = {
          id: path,
          label: part,
          children: [],
          unreadCount: 0,
        };
        nodes.set(path, node);
        siblings.push(node);
      }

      if (index === parts.length - 1) {
        node.mailbox = mailbox;
        node.unreadCount = mailbox.unreadCount;
      }

      siblings = node.children;
    }
  }

  for (const node of [...nodes.values()].sort(
    (first, second) => second.id.length - first.id.length,
  )) {
    node.unreadCount = node.mailbox?.unreadCount ?? 0;
    node.children.sort((first, second) => first.label.localeCompare(second.label));
  }

  roots.sort((first, second) => first.label.localeCompare(second.label));

  return roots;
}

function startColumnResize(column: "nav" | "list", event: PointerEvent) {
  activeResize.value = column;
  resizeStartX = event.clientX;
  resizeStartWidth = column === "nav" ? navColumnWidth.value : listColumnWidth.value;
  window.addEventListener("pointermove", resizeColumn);
  window.addEventListener("pointerup", stopColumnResize);
  document.body.classList.add("reader-resizing");
}

function resizeColumn(event: PointerEvent) {
  if (!activeResize.value) {
    return;
  }

  const nextWidth = resizeStartWidth + event.clientX - resizeStartX;

  if (activeResize.value === "nav") {
    navColumnWidth.value = clamp(nextWidth, 192, 384);
    return;
  }

  listColumnWidth.value = clamp(nextWidth, 280, 640);
}

function stopColumnResize() {
  activeResize.value = null;
  window.removeEventListener("pointermove", resizeColumn);
  window.removeEventListener("pointerup", stopColumnResize);
  document.body.classList.remove("reader-resizing");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readSavedReaderLayout(): { navColumnWidth: number; listColumnWidth: number } {
  const fallback = {
    navColumnWidth: 256,
    listColumnWidth: 384,
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(readerLayoutStorageKey) ?? "null") as Partial<{
      navColumnWidth: number;
      listColumnWidth: number;
    }> | null;

    if (!parsed) {
      return fallback;
    }

    return {
      navColumnWidth: clamp(Number(parsed.navColumnWidth), 192, 384),
      listColumnWidth: clamp(Number(parsed.listColumnWidth), 280, 640),
    };
  } catch {
    return fallback;
  }
}

function senderLabel(message: MailboxMessageSummary): string {
  return message.sender.displayName || message.sender.address;
}

function participantLabel(participant: { address: string; displayName?: string }): string {
  return participant.displayName || participant.address;
}

function participantsLabel(participants: Array<{ address: string; displayName?: string }>): string {
  return participants.map(participantLabel).join(", ");
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

function accountDefaultPath(account: MailAccountMailboxTree): string | undefined {
  return defaultReaderPath([account]);
}

async function selectAccountDefault(account: MailAccountMailboxTree) {
  const path = accountDefaultPath(account);

  if (path) {
    await selectList(path);
  }
}
</script>

<template>
  <main class="min-h-screen bg-stone-100 text-slate-950">
    <section
      v-if="!authenticated"
      class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6"
    >
      <div class="mb-8">
        <h1 class="text-3xl font-semibold tracking-normal">ZMail</h1>
        <p class="mt-3 text-sm text-slate-600">
          API {{ healthQuery.data.value?.status ?? "checking" }}
        </p>
      </div>

      <form class="w-full max-w-sm space-y-4" @submit.prevent="submitLogin">
        <UFormField label="Username">
          <UInput
            v-model="username"
            class="w-full"
            autocomplete="username"
            name="username"
            size="xl"
          />
        </UFormField>
        <UFormField label="Password">
          <UInput
            v-model="password"
            class="w-full"
            autocomplete="current-password"
            name="password"
            size="xl"
            type="password"
          />
        </UFormField>
        <UAlert v-if="loginError" color="error" variant="soft" :title="loginError" />
        <button
          class="flex h-11 w-32 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="loginMutation.isPending.value"
          type="submit"
        >
          {{ loginMutation.isPending.value ? "Logging in..." : "Log in" }}
        </button>
      </form>
    </section>

    <section v-else class="flex h-screen min-h-0 flex-col bg-stone-100">
      <header
        class="flex h-10 shrink-0 items-center justify-between border-b border-stone-300 bg-stone-200 px-3"
      >
        <div class="min-w-0">
          <p class="text-sm font-semibold">ZM</p>
        </div>
        <div class="flex items-center gap-2">
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

      <div v-else class="reader-grid grid min-h-0 flex-1 grid-cols-1" :style="readerGridStyle">
        <aside
          class="min-h-0 border-r border-stone-300 bg-stone-100"
          :class="mobilePane === 'nav' ? 'block' : 'hidden lg:block'"
          aria-label="Account mailbox tree"
        >
          <div class="flex h-full flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto p-2">
              <div v-for="account in mailAccounts" :key="account.id" class="mb-3">
                <div class="flex items-start justify-between gap-1">
                  <button
                    class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-stone-200"
                    type="button"
                    :aria-label="
                      accountCollapsed(account.id) ? 'Expand account' : 'Collapse account'
                    "
                    @click="toggleAccount(account.id)"
                  >
                    <span class="text-[10px]">{{ accountCollapsed(account.id) ? ">" : "v" }}</span>
                  </button>
                  <button
                    class="min-w-0 flex-1 text-left"
                    type="button"
                    @click="selectAccountDefault(account)"
                  >
                    <span class="block truncate text-xs font-semibold">{{ account.id }}</span>
                    <span class="block truncate text-[11px] text-slate-500">{{
                      account.emailAddress
                    }}</span>
                    <span class="block truncate text-[11px] text-slate-500">{{
                      accountSyncStatusLabel(account.syncStatus)
                    }}</span>
                  </button>
                  <div class="flex shrink-0 items-center gap-1">
                    <UBadge
                      v-if="account.unreadCount > 0"
                      color="neutral"
                      size="sm"
                      variant="subtle"
                      >{{ account.unreadCount }}</UBadge
                    >
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
                <div v-if="!accountCollapsed(account.id)" class="mt-1 space-y-0.5">
                  <div
                    v-for="row in visibleMailboxRows(account)"
                    :key="row.key"
                    class="group flex items-center gap-1 rounded-md py-1 text-xs hover:bg-stone-200"
                    :class="
                      readerRoute.kind === 'mailbox' &&
                      readerRoute.accountId === account.id &&
                      row.mailbox &&
                      readerRoute.mailboxId === row.mailbox.id
                        ? 'bg-stone-200'
                        : ''
                    "
                    :style="{ paddingLeft: `${row.depth * 12 + 2}px`, paddingRight: '6px' }"
                  >
                    <button
                      v-if="row.hasChildren"
                      class="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-500 hover:bg-stone-300"
                      type="button"
                      :aria-label="
                        row.collapsed ? 'Expand mailbox group' : 'Collapse mailbox group'
                      "
                      @click.stop="toggleMailboxGroup(account.id, row.id)"
                    >
                      <span class="text-[9px]">{{ row.collapsed ? ">" : "v" }}</span>
                    </button>
                    <span v-else class="h-4 w-4 shrink-0"></span>
                    <button
                      class="min-w-0 flex-1 truncate text-left"
                      :class="row.mailbox ? '' : 'font-medium text-slate-600'"
                      type="button"
                      @click="
                        row.mailbox
                          ? selectList(mailboxPath(account.id, row.mailbox.id))
                          : toggleMailboxGroup(account.id, row.id)
                      "
                    >
                      {{ row.label }}
                    </button>
                    <UBadge v-if="row.unreadCount > 0" color="neutral" size="sm" variant="subtle">{{
                      row.unreadCount
                    }}</UBadge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div
          class="reader-resize-handle hidden lg:block"
          :class="activeResize === 'nav' ? 'reader-resize-handle-active' : ''"
          aria-label="Resize mailbox navigation"
          role="separator"
          tabindex="0"
          @pointerdown.prevent="startColumnResize('nav', $event)"
        ></div>

        <section
          class="min-h-0 border-r border-stone-300 bg-stone-100"
          :class="mobilePane === 'list' ? 'block' : 'hidden lg:block'"
          aria-label="Message list"
        >
          <div class="flex h-full flex-col">
            <div class="space-y-2 border-b border-stone-300 bg-stone-100 p-2">
              <div class="flex items-center gap-2 lg:hidden">
                <UButton
                  aria-label="Account mailbox tree"
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
                <button
                  class="h-8 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
                  type="submit"
                >
                  Search
                </button>
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
                class="block w-full border-b border-stone-300 px-3 py-2 text-left hover:bg-stone-200"
                :class="[
                  message.unread
                    ? 'border-l-4 border-l-slate-800 bg-stone-50'
                    : 'border-l-4 border-l-transparent bg-stone-100',
                  selectedMessageId === message.id ? 'bg-stone-200' : '',
                ]"
                type="button"
                @click="selectMessage(message.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span
                    class="truncate text-xs"
                    :class="message.unread ? 'font-bold text-slate-950' : 'font-medium'"
                  >
                    {{ senderLabel(message) }}
                  </span>
                  <span class="shrink-0 text-[11px] text-slate-500">{{
                    formatDate(message.receivedAt)
                  }}</span>
                </div>
                <p
                  class="mt-0.5 truncate text-xs"
                  :class="message.unread ? 'font-bold text-slate-950' : 'text-slate-700'"
                >
                  {{ message.subject || "(No subject)" }}
                </p>
                <p
                  class="mt-0.5 line-clamp-2 text-[11px] leading-4"
                  :class="message.unread ? 'font-medium text-slate-700' : 'text-slate-500'"
                >
                  {{ message.snippet }}
                </p>
              </button>
            </div>
          </div>
        </section>

        <div
          class="reader-resize-handle hidden lg:block"
          :class="activeResize === 'list' ? 'reader-resize-handle-active' : ''"
          aria-label="Resize message list"
          role="separator"
          tabindex="0"
          @pointerdown.prevent="startColumnResize('list', $event)"
        ></div>

        <article
          class="min-h-0 bg-stone-50"
          :class="mobilePane === 'message' ? 'block' : 'hidden lg:block'"
          aria-label="Message content"
        >
          <div class="flex h-full flex-col">
            <div
              class="flex h-12 shrink-0 items-center gap-2 border-b border-stone-300 bg-stone-100 px-3"
            >
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
                <div v-if="selectedMessage.recipients.length" class="mt-1 text-sm text-slate-600">
                  <span class="font-medium text-slate-700">To</span>
                  {{ participantsLabel(selectedMessage.recipients) }}
                </div>
                <div v-if="selectedMessage.ccRecipients.length" class="mt-1 text-sm text-slate-600">
                  <span class="font-medium text-slate-700">Cc</span>
                  {{ participantsLabel(selectedMessage.ccRecipients) }}
                </div>
                <div
                  v-if="selectedMessage.bccRecipients.length"
                  class="mt-1 text-sm text-slate-600"
                >
                  <span class="font-medium text-slate-700">Bcc</span>
                  {{ participantsLabel(selectedMessage.bccRecipients) }}
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
                <iframe
                  class="message-body mt-6 block w-full"
                  sandbox="allow-popups"
                  :srcdoc="renderedMessage.srcdoc"
                  title="Message body"
                ></iframe>
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
