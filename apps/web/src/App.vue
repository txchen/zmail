<script setup lang="ts">
import type {
  AccountRefreshRequest,
  LiveMailAccount,
  LiveMessageDetail,
  MailAccountSummary,
  MailAccountMailboxTree,
  LiveMessagePage,
  MailboxAction,
  MailboxSummary,
  SyncJobRecord,
} from "@zmail/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchHealth,
  downloadAttachment,
  fetchMailAccounts,
  fetchMessage,
  fetchMessagesForMailbox,
  fetchSession,
  fetchSyncJobs,
  fetchUnreadMessagesForAccount,
  login,
  logout,
  openMailAccount,
  performMailboxAction,
  refreshMailAccount,
  scheduleSyncJob,
  searchMessagesForAccount,
} from "./api";
import {
  appendLiveMessagePage,
  cacheManualRefresh,
  ephemeralMailQueryPolicy,
  liveMessageDetailKey,
  liveMessageListKey,
  type LiveBrowserMessageListView,
} from "./live-mail-memory";
import { renderReadableMessage } from "./message-rendering";
import {
  applyConfirmedAccountCounts,
  confirmationRemovesSourceView,
  createMailboxActionController,
} from "./mailbox-action-controller";
import { confirmedRenderedMessageKey, createReadDwellController } from "./read-dwell";
import {
  defaultReaderPath,
  listPath,
  mailboxPath,
  messageListViewForRoute,
  messagePath,
  nextMessagePathAfterRemoval,
  parseReaderRoute,
  searchPath,
  unreadPath,
  type ReaderRoute,
} from "./reader-routes";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

const username = ref("");
const password = ref("");
const loginError = ref("");
const remoteImagesAllowedMessageKeys = ref(new Set<string>());
const mobilePane = ref<"nav" | "list" | "message">("nav");
const lastListRouteByAccount = ref(new Map<string, string>());
const searchDraft = ref("");
const loggedOut = ref(false);
const openedMailAccounts = ref(new Map<string, MailAccountMailboxTree>());
const accountOpenErrorId = ref("");
const readerLayoutStorageKey = "zmail.readerLayout.v1";
const savedReaderLayout = readSavedReaderLayout();
const navColumnWidth = ref(savedReaderLayout.navColumnWidth);
const listColumnWidth = ref(savedReaderLayout.listColumnWidth);
const collapsedAccounts = ref(new Set(savedReaderLayout.collapsedAccounts));
const collapsedMailboxGroups = ref(new Set(savedReaderLayout.collapsedMailboxGroups));
const activeResize = ref<"nav" | "list" | null>(null);
const syncJobsOpen = ref(false);
const syncJobsMenu = ref<HTMLElement | null>(null);
const customSyncDialogOpen = ref(false);
const customSyncAccountId = ref("");
const customSyncDays = ref(90);
const documentVisible = ref(
  typeof document === "undefined" ? true : document.visibilityState !== "hidden",
);
const windowFocused = ref(typeof document === "undefined" ? true : document.hasFocus());
const renderedBodyMessageKey = ref("");
const mailboxActionError = ref("");
const failedManualRefresh = ref<{ accountId: string; request: AccountRefreshRequest } | null>(null);
const attachmentDownloadError = ref<AttachmentDownloadRequest | null>(null);
const failedLoadMore = ref<LoadMoreRequest | null>(null);
const liveMessageListPageSize = 50;
let resizeStartX = 0;
let resizeStartWidth = 0;
let attachmentDownloadAbortController: AbortController | undefined;

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

const mailAccountsQuery = useQuery({
  queryKey: ["mail-accounts"],
  queryFn: () => fetchMailAccounts(),
  enabled: authenticated,
});

const syncJobsQuery = useQuery({
  queryKey: ["sync-jobs"],
  queryFn: () => fetchSyncJobs(),
  enabled: computed(() => authenticated.value && syncJobsOpen.value),
  ...ephemeralMailQueryPolicy,
});

const configuredMailAccounts = computed(() => mailAccountsQuery.data.value?.mailAccounts ?? []);
const readDwellSeconds = computed(
  () => mailAccountsQuery.data.value?.reader?.readDwellSeconds ?? 3,
);
const mailAccounts = computed(() => [...openedMailAccounts.value.values()]);
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
const messageListView = computed(() => messageListViewForRoute(readerRoute.value));
const searchQuery = computed(() =>
  readerRoute.value.kind === "search" ? readerRoute.value.query : "",
);
const readerGridStyle = computed(() => ({
  "--reader-nav-width": `${navColumnWidth.value}px`,
  "--reader-list-width": `${listColumnWidth.value}px`,
}));
const syncJobs = computed(() => syncJobsQuery.data.value?.jobs ?? []);
const displayedSyncJobs = computed(() => {
  const seenAutomaticSuccesses = new Set<string>();

  return syncJobs.value.filter((job) => {
    if (job.state === "pending" || job.state === "running" || job.state === "failed") {
      return true;
    }

    if (job.origin === "appUser") {
      return true;
    }

    if (job.state !== "succeeded") {
      return false;
    }

    const key = `${job.accountId}:${syncJobScopeKey(job.scope)}`;
    if (seenAutomaticSuccesses.has(key)) {
      return false;
    }

    seenAutomaticSuccesses.add(key);
    return true;
  });
});
const activeSyncJobs = computed(() =>
  syncJobs.value.filter((job) => job.state === "pending" || job.state === "running"),
);
const syncingAccountIds = computed(() => new Set(activeSyncJobs.value.map((job) => job.accountId)));
const customSyncAccount = computed(() =>
  mailAccounts.value.find((account) => account.id === customSyncAccountId.value),
);
const customSyncRangeOptions = [
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
  { label: "Last 365 days", value: 365 },
  { label: "Last 2 years", value: 730 },
  { label: "Last 10 years", value: 3650 },
];

const messageListQuery = useQuery({
  queryKey: computed(() => ["message-list", messageListView.value]),
  queryFn: () => {
    const current = readerRoute.value;

    if (current.kind === "unread") {
      return fetchUnreadMessagesForAccount(current.accountId, {
        limit: liveMessageListPageSize,
      });
    }

    if (current.kind === "mailbox") {
      return fetchMessagesForMailbox(current.accountId, current.mailboxId, {
        limit: liveMessageListPageSize,
      });
    }

    if (current.kind === "search") {
      return searchMessagesForAccount(current.accountId, current.query, {
        limit: liveMessageListPageSize,
      });
    }

    return { messages: [] };
  },
  enabled: computed(
    () =>
      authenticated.value &&
      readerRoute.value.kind !== "none" &&
      openedMailAccounts.value.has(selectedAccountId.value),
  ),
  ...ephemeralMailQueryPolicy,
});

const messages = computed(() => messageListQuery.data.value?.messages ?? []);
const messageListNextCursor = computed(() => messageListQuery.data.value?.nextCursor);

type LoadMoreRequest = {
  view: LiveBrowserMessageListView;
  cursor: string;
};

const loadMoreMessagesMutation = useMutation({
  mutationFn: async ({ view, cursor }: LoadMoreRequest) => {
    if (view.kind === "unread") {
      return {
        view,
        page: await fetchUnreadMessagesForAccount(view.accountId, {
          limit: liveMessageListPageSize,
          cursor,
        }),
      };
    }

    if (view.kind === "mailbox") {
      return {
        view,
        page: await fetchMessagesForMailbox(view.accountId, view.mailboxId, {
          limit: liveMessageListPageSize,
          cursor,
        }),
      };
    }

    return {
      view,
      page: await searchMessagesForAccount(view.accountId, view.query, {
        limit: liveMessageListPageSize,
        cursor,
      }),
    };
  },
  onSuccess: ({ view, page }) => {
    failedLoadMore.value = null;
    appendLiveMessagePage(queryClient, view, page as LiveMessagePage);
  },
  onError: (_error, request) => {
    failedLoadMore.value = request;
  },
});

const messageDetailQuery = useQuery({
  queryKey: computed(() => liveMessageDetailKey(selectedAccountId.value, selectedMessageId.value)),
  queryFn: () => fetchMessage(selectedAccountId.value, selectedMessageId.value),
  ...ephemeralMailQueryPolicy,
  enabled: computed(
    () => authenticated.value && !!selectedAccountId.value && !!selectedMessageId.value,
  ),
});

const selectedMessage = computed<LiveMessageDetail | null>(
  () => messageDetailQuery.data.value?.message ?? null,
);
const selectedMessageKey = computed(() =>
  selectedMessage.value ? messageRemoteImagesKey(selectedMessage.value) : "",
);
const selectedMessageRemoteImagesAllowed = computed(
  () =>
    !!selectedMessageKey.value &&
    remoteImagesAllowedMessageKeys.value.has(selectedMessageKey.value),
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
    showRemoteImages: selectedMessageRemoteImagesAllowed.value,
  });
});

const loginMutation = useMutation({
  mutationFn: () => login({ username: username.value, password: password.value }),
  onSuccess: async () => {
    loginError.value = "";
    loggedOut.value = false;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["session"] }),
      queryClient.invalidateQueries({ queryKey: ["mail-accounts"] }),
    ]);
  },
  onError: () => {
    loginError.value = "Login failed";
  },
});

const logoutMutation = useMutation({
  mutationFn: () => logout(),
  onMutate: async () => {
    readDwellController.cancel();
    attachmentDownloadAbortController?.abort();
    loggedOut.value = true;
    openedMailAccounts.value = new Map();
    remoteImagesAllowedMessageKeys.value = new Set();
    lastListRouteByAccount.value = new Map();
    searchDraft.value = "";
    accountOpenErrorId.value = "";
    failedManualRefresh.value = null;
    attachmentDownloadError.value = null;
    failedLoadMore.value = null;
    mailboxActionError.value = "";
    renderedBodyMessageKey.value = "";
    queryClient.clear();
    queryClient.setQueryData(["session"], { authenticated: false });
    await router.push("/");
  },
});

const accountOpenMutation = useMutation({
  mutationFn: (accountId: string) => openMailAccount(accountId),
  onSuccess: async (response) => {
    accountOpenErrorId.value = "";
    const account = accountTreeFromLiveAccount(response.mailAccount);
    openedMailAccounts.value = new Map(openedMailAccounts.value).set(account.id, account);
    const inboxRoute = {
      kind: "mailbox" as const,
      accountId: account.id,
      mailboxId: response.inbox.mailboxId,
    };

    queryClient.setQueryData(liveMessageListKey(inboxRoute), {
      messages: response.inbox.messages,
      ...(response.inbox.nextCursor ? { nextCursor: response.inbox.nextCursor } : {}),
    });
    await router.push(mailboxPath(account.id, response.inbox.mailboxId));
  },
  onError: (_error, accountId) => {
    accountOpenErrorId.value = accountId;
  },
});

const manualRefreshMutation = useMutation({
  mutationFn: async ({
    accountId,
    request,
  }: {
    accountId: string;
    request: AccountRefreshRequest;
  }) => {
    const response = await refreshMailAccount(accountId, request);
    return { accountId, response };
  },
  onSuccess: async ({ accountId, response }) => {
    failedManualRefresh.value = null;
    if (
      response.selectedMessageId &&
      !response.selectedMessage &&
      selectedAccountId.value === accountId &&
      selectedMessageId.value === response.selectedMessageId
    ) {
      await router.replace(listPath(readerRoute.value, route.fullPath));
    }

    openedMailAccounts.value = new Map(openedMailAccounts.value).set(
      accountId,
      accountTreeFromLiveAccount(response.mailAccount),
    );
    cacheManualRefresh(queryClient, accountId, response);
  },
  onError: (_error, variables) => {
    failedManualRefresh.value = variables;
  },
});

type AttachmentDownloadRequest = {
  accountId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
};

const attachmentDownloadMutation = useMutation({
  mutationFn: async (request: AttachmentDownloadRequest) => {
    const controller = new AbortController();
    attachmentDownloadAbortController = controller;
    try {
      return {
        request,
        blob: await downloadAttachment(
          request.accountId,
          request.messageId,
          request.attachmentId,
          fetch,
          controller.signal,
        ),
      };
    } finally {
      if (attachmentDownloadAbortController === controller) {
        attachmentDownloadAbortController = undefined;
      }
    }
  },
  onSuccess: ({ request, blob }) => {
    attachmentDownloadError.value = null;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = request.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },
  onError: (error, request) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    attachmentDownloadError.value = request;
  },
});

const syncJobMutation = useMutation({
  mutationFn: (request: { accountId: string; days?: number }) => scheduleSyncJob(request),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
  },
});

const mailboxActionController = createMailboxActionController({
  queryClient,
  perform: performMailboxAction,
  mailboxesForAccount: (accountId) => openedMailAccounts.value.get(accountId)?.mailboxes ?? [],
});

type MailboxActionVariables = {
  accountId: string;
  messageId: string;
  action: MailboxAction;
  sourceView: ReaderRoute;
};

const mailboxActionMutation = useMutation({
  mutationFn: ({ accountId, messageId, action }: MailboxActionVariables) =>
    mailboxActionController.perform({ accountId, messageId, action }),
  onSuccess: (confirmation, variables) => {
    mailboxActionError.value = "";
    const account = openedMailAccounts.value.get(confirmation.accountId);
    if (account) {
      openedMailAccounts.value = new Map(openedMailAccounts.value).set(
        account.id,
        applyConfirmedAccountCounts(account, confirmation),
      );
    }

    if (
      confirmationRemovesSourceView(confirmation, variables.sourceView) &&
      selectedAccountId.value === variables.accountId &&
      selectedMessageId.value === variables.messageId
    ) {
      openAdjacentMessage(variables.messageId);
    }
  },
  onError: (error) => {
    mailboxActionError.value =
      error instanceof Error
        ? error.message
        : "Gmail did not confirm the Mailbox action. Refresh to verify or safely repeat the same target-state action.";
  },
});

const readDwellController = createReadDwellController({
  dwellSeconds: () => readDwellSeconds.value,
  markRead: ({ accountId, messageId }) =>
    mailboxActionMutation
      .mutateAsync(mailboxActionVariables(accountId, messageId, "markRead"))
      .then(() => {}),
});

watch(
  () => route.fullPath,
  (fullPath) => {
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
  saveReaderLayout(nextNavWidth, nextListWidth);
});

watch([collapsedAccounts, collapsedMailboxGroups], () => {
  saveReaderLayout(navColumnWidth.value, listColumnWidth.value);
});

watch([selectedAccountId, selectedMessageId], () => {
  renderedBodyMessageKey.value = "";
});

watch(
  [
    selectedAccountId,
    selectedMessageId,
    selectedMessage,
    authenticated,
    documentVisible,
    windowFocused,
    renderedBodyMessageKey,
  ],
  () => {
    const message = selectedMessage.value;
    const key = message ? messageRemoteImagesKey(message) : "";
    readDwellController.update({
      accountId: selectedAccountId.value,
      messageId: selectedMessageId.value,
      unread: message?.unread ?? false,
      selected: !!message && message.id === selectedMessageId.value,
      visible: documentVisible.value,
      focused: windowFocused.value,
      authenticated: authenticated.value,
      bodyRendered: !!key && !!renderedMessage.value && renderedBodyMessageKey.value === key,
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopColumnResize();
  document.removeEventListener("visibilitychange", updateDocumentVisible);
  document.removeEventListener("pointerdown", dismissSyncJobsOnOutsidePointer);
  window.removeEventListener("focus", updateWindowFocus);
  window.removeEventListener("blur", updateWindowFocus);
  readDwellController.cancel();
});

onMounted(() => {
  void router.replace("/");
  document.addEventListener("visibilitychange", updateDocumentVisible);
  document.addEventListener("pointerdown", dismissSyncJobsOnOutsidePointer);
  window.addEventListener("focus", updateWindowFocus);
  window.addEventListener("blur", updateWindowFocus);
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
  const query = searchDraft.value;
  if (!selectedAccountId.value || !query.trim()) {
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

function runMailboxAction(action: MailboxAction) {
  if (!selectedMessage.value) {
    return;
  }

  mailboxActionMutation.mutate({
    ...mailboxActionVariables(selectedMessage.value.accountId, selectedMessage.value.id, action),
  });
}

function mailboxActionVariables(
  accountId: string,
  messageId: string,
  action: MailboxAction,
): MailboxActionVariables {
  const sourceView = readerRoute.value;
  return {
    accountId,
    messageId,
    action,
    sourceView,
  };
}

function markMessageBodyRendered(event: Event) {
  const renderedKey =
    event.currentTarget instanceof HTMLIFrameElement
      ? event.currentTarget.dataset.messageKey
      : undefined;
  const confirmedKey = confirmedRenderedMessageKey(renderedKey, selectedMessageKey.value);
  if (confirmedKey && renderedMessage.value) {
    renderedBodyMessageKey.value = confirmedKey;
  }
}

function allowRemoteImagesForSelectedMessage() {
  if (!selectedMessageKey.value) {
    return;
  }

  remoteImagesAllowedMessageKeys.value = new Set([
    ...remoteImagesAllowedMessageKeys.value,
    selectedMessageKey.value,
  ]);
}

function messageRemoteImagesKey(message: LiveMessageDetail): string {
  return `${message.accountId}:${message.id}`;
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

function updateDocumentVisible(): void {
  documentVisible.value = document.visibilityState !== "hidden";
}

function updateWindowFocus(): void {
  windowFocused.value = document.hasFocus();
}

function dismissSyncJobsOnOutsidePointer(event: PointerEvent): void {
  if (!syncJobsOpen.value || !syncJobsMenu.value) {
    return;
  }

  if (event.target instanceof Node && syncJobsMenu.value.contains(event.target)) {
    return;
  }

  syncJobsOpen.value = false;
}

function accountContextMenuItems(account: MailAccountMailboxTree) {
  return [
    {
      label: "Refresh",
      icon: "i-lucide-refresh-cw",
      disabled: manualRefreshMutation.isPending.value,
      onSelect: () => manualRefreshMutation.mutate(manualRefreshRequest(account.id)),
    },
    {
      label: "Sync now",
      icon: "i-lucide-refresh-cw",
      disabled: syncingAccountIds.value.has(account.id) || syncJobMutation.isPending.value,
      onSelect: () => syncJobMutation.mutate({ accountId: account.id }),
    },
    {
      label: "Custom sync...",
      icon: "i-lucide-calendar-clock",
      disabled: syncingAccountIds.value.has(account.id) || syncJobMutation.isPending.value,
      onSelect: () => openCustomSyncDialog(account),
    },
  ];
}

function openCustomSyncDialog(account: MailAccountMailboxTree) {
  customSyncAccountId.value = account.id;
  customSyncDays.value = 90;
  customSyncDialogOpen.value = true;
}

function submitCustomSync() {
  if (!customSyncAccountId.value) {
    return;
  }

  syncJobMutation.mutate({ accountId: customSyncAccountId.value, days: customSyncDays.value });
  customSyncDialogOpen.value = false;
}

function syncJobSummary(job: SyncJobRecord): string {
  if (job.state === "failed") {
    return job.error ?? "Sync job failed";
  }

  if (!job.result) {
    return job.scope.type;
  }

  return [
    `${job.result.fetchedMessageCount ?? 0} fetched`,
    `${job.result.storedMessageCount ?? 0} stored`,
    `${job.result.removedMailboxEntryCount ?? 0} removed`,
  ].join(" / ");
}

function syncJobStateIcon(job: SyncJobRecord): string {
  if (job.state === "succeeded") {
    return "✅";
  }

  if (job.state === "failed") {
    return "❌";
  }

  if (job.state === "running") {
    return "▶";
  }

  if (job.state === "pending") {
    return "…";
  }

  return "·";
}

function syncJobScopeLabel(job: SyncJobRecord): string {
  if (job.scope.type === "regular") {
    return "Regular";
  }

  if (job.scope.type === "recentReconciliation") {
    return `Reconcile ${job.scope.days}d`;
  }

  return `Custom ${job.scope.days}d`;
}

function syncJobScopeKey(scope: SyncJobRecord["scope"]): string {
  if (scope.type === "regular") {
    return "regular";
  }

  return `${scope.type}:${scope.days}`;
}

function syncJobOriginLabel(job: SyncJobRecord): string {
  return job.origin === "automatic" ? "⟳" : "👤";
}

function syncJobTime(job: SyncJobRecord): string {
  return formatDate(job.finishedAt ?? job.startedAt ?? job.createdAt);
}

function syncJobDuration(job: SyncJobRecord): string {
  const durationMs =
    job.startedAt && job.finishedAt
      ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()
      : job.result?.durationMs;

  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1_000).toFixed(1)}s`;
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

function readSavedReaderLayout(): {
  navColumnWidth: number;
  listColumnWidth: number;
  collapsedAccounts: string[];
  collapsedMailboxGroups: string[];
} {
  const fallback = {
    navColumnWidth: 256,
    listColumnWidth: 384,
    collapsedAccounts: [] as string[],
    collapsedMailboxGroups: [] as string[],
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(readerLayoutStorageKey) ?? "null") as Partial<{
      navColumnWidth: number;
      listColumnWidth: number;
      collapsedAccounts: string[];
      collapsedMailboxGroups: string[];
    }> | null;

    if (!parsed) {
      return fallback;
    }

    return {
      navColumnWidth: clamp(Number(parsed.navColumnWidth), 192, 384),
      listColumnWidth: clamp(Number(parsed.listColumnWidth), 280, 640),
      collapsedAccounts: Array.isArray(parsed.collapsedAccounts) ? parsed.collapsedAccounts : [],
      collapsedMailboxGroups: Array.isArray(parsed.collapsedMailboxGroups)
        ? parsed.collapsedMailboxGroups
        : [],
    };
  } catch {
    return fallback;
  }
}

function saveReaderLayout(navWidth: number, listWidth: number) {
  localStorage.setItem(
    readerLayoutStorageKey,
    JSON.stringify({
      navColumnWidth: navWidth,
      listColumnWidth: listWidth,
      collapsedAccounts: [...collapsedAccounts.value],
      collapsedMailboxGroups: [...collapsedMailboxGroups.value],
    }),
  );
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
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
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

function openConfiguredAccount(account: MailAccountSummary): void {
  accountOpenErrorId.value = "";
  accountOpenMutation.mutate(account.id);
}

function retryAccountOpen(): void {
  if (accountOpenErrorId.value) {
    accountOpenMutation.mutate(accountOpenErrorId.value);
  }
}

function manualRefreshRequest(accountId: string): {
  accountId: string;
  request: AccountRefreshRequest;
} {
  const current = readerRoute.value;
  let view: AccountRefreshRequest["view"];

  if (current.kind === "mailbox" && current.accountId === accountId) {
    view = { kind: "mailbox", mailboxId: current.mailboxId };
  } else if (current.kind === "unread" && current.accountId === accountId) {
    view = { kind: "unread" };
  } else {
    const inbox = openedMailAccounts.value
      .get(accountId)
      ?.mailboxes.find((mailbox) => mailbox.systemRole === "inbox");
    if (!inbox) {
      throw new Error("Inbox unavailable");
    }
    view = { kind: "mailbox", mailboxId: inbox.id };
  }

  return {
    accountId,
    request: {
      view,
      ...(current.kind !== "none" && current.accountId === accountId && current.messageId
        ? { selectedMessageId: current.messageId }
        : {}),
    },
  };
}

function requestAttachmentDownload(request: AttachmentDownloadRequest): void {
  attachmentDownloadError.value = null;
  attachmentDownloadMutation.mutate(request);
}

function loadMoreMessages(): void {
  const cursor = messageListNextCursor.value;
  const view = messageListView.value;
  if (cursor && view.kind !== "none") {
    loadMoreMessagesMutation.mutate({ view, cursor });
  }
}

function accountTreeFromLiveAccount(account: LiveMailAccount): MailAccountMailboxTree {
  return {
    ...account,
    syncStatus: "synced",
  };
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
          <button class="text-sm font-semibold" type="button" @click="router.push('/')">
            ZMail
          </button>
        </div>
        <div ref="syncJobsMenu" class="relative flex items-center gap-2">
          <UButton
            v-if="activeSyncJobs.length > 0"
            color="neutral"
            icon="i-lucide-loader-circle"
            square
            :ui="{ leadingIcon: 'animate-spin' }"
            variant="ghost"
            aria-label="Show Sync jobs"
            @click="syncJobsOpen = !syncJobsOpen"
          />
          <UButton
            v-else
            color="neutral"
            icon="i-lucide-history"
            square
            variant="ghost"
            aria-label="Show Sync jobs"
            @click="syncJobsOpen = !syncJobsOpen"
          />
          <div
            v-if="syncJobsOpen"
            class="absolute right-10 top-9 z-20 flex max-h-[32rem] w-96 flex-col rounded-md border border-stone-300 bg-white p-2 shadow-lg"
          >
            <div class="flex shrink-0 items-center justify-between gap-2 px-2 pb-2">
              <p class="text-xs font-semibold uppercase text-slate-500">Sync activity</p>
              <p class="text-[11px] text-slate-400">{{ displayedSyncJobs.length }} shown</p>
            </div>
            <div v-if="displayedSyncJobs.length === 0" class="px-2 py-3 text-sm text-slate-500">
              No recent jobs.
            </div>
            <div v-else class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              <div
                v-for="job in displayedSyncJobs"
                :key="job.id"
                class="rounded border border-stone-200 px-2 py-1.5 text-xs"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-medium">
                    <span class="mr-1">{{ syncJobStateIcon(job) }}</span
                    >{{ job.accountId }}
                  </span>
                  <span class="shrink-0 text-slate-500">
                    {{ syncJobTime(job) }}
                  </span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2 text-slate-500">
                  <span class="truncate"
                    >{{ syncJobOriginLabel(job) }} {{ syncJobScopeLabel(job) }} ·
                    {{ syncJobSummary(job) }}</span
                  >
                  <span v-if="syncJobDuration(job)" class="shrink-0">{{
                    syncJobDuration(job)
                  }}</span>
                </div>
              </div>
            </div>
          </div>
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

      <UAlert
        v-if="failedManualRefresh"
        color="error"
        variant="soft"
        title="Manual refresh failed"
        :description="`Could not refresh ${failedManualRefresh.accountId}.`"
      >
        <template #actions>
          <button
            class="h-8 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
            type="button"
            @click="manualRefreshMutation.mutate(failedManualRefresh)"
          >
            Manual retry
          </button>
        </template>
      </UAlert>

      <UModal
        v-model:open="customSyncDialogOpen"
        title="Custom sync"
        :description="customSyncAccount?.emailAddress ?? customSyncAccountId"
      >
        <template #body>
          <form class="space-y-4" @submit.prevent="submitCustomSync">
            <div class="space-y-2">
              <label class="block text-sm font-medium text-slate-700" for="custom-sync-range">
                Message range
              </label>
              <USelect
                id="custom-sync-range"
                v-model="customSyncDays"
                :items="customSyncRangeOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </div>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" @click="customSyncDialogOpen = false">
                Cancel
              </UButton>
              <button
                class="h-8 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                :disabled="!customSyncAccountId || syncJobMutation.isPending.value"
              >
                {{ syncJobMutation.isPending.value ? "Starting..." : "Start sync" }}
              </button>
            </div>
          </form>
        </template>
      </UModal>

      <div
        v-if="readerRoute.kind === 'none'"
        class="grid flex-1 place-items-center px-6 text-center"
      >
        <div class="w-full max-w-lg">
          <h2 class="text-xl font-semibold">Choose a Mail account</h2>
          <p class="mt-2 text-sm text-slate-600">
            Zmail connects to Gmail only after you select an account.
          </p>
          <p v-if="configuredMailAccounts.length === 0" class="mt-6 text-sm text-slate-500">
            No Mail accounts are configured.
          </p>
          <div v-else class="mt-6 space-y-2 text-left">
            <button
              v-for="account in configuredMailAccounts"
              :key="account.id"
              class="flex w-full items-center justify-between rounded-md border border-stone-300 bg-white px-4 py-3 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
              type="button"
              :disabled="accountOpenMutation.isPending.value"
              @click="openConfiguredAccount(account)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold">{{ account.id }}</span>
                <span class="block truncate text-xs text-slate-500">{{
                  account.emailAddress
                }}</span>
              </span>
              <span class="shrink-0 text-sm text-slate-600">
                {{ accountOpenMutation.isPending.value ? "Opening..." : "Open Inbox" }}
              </span>
            </button>
            <UAlert
              v-if="accountOpenErrorId"
              color="error"
              variant="soft"
              title="Mail account unavailable"
              :description="`Could not open ${accountOpenErrorId}. Choose another account or retry.`"
            >
              <template #actions>
                <button
                  class="h-8 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
                  type="button"
                  @click="retryAccountOpen"
                >
                  Manual retry
                </button>
              </template>
            </UAlert>
          </div>
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
                <UContextMenu :items="accountContextMenuItems(account)">
                  <div class="flex items-start justify-between gap-1">
                    <button
                      class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-stone-200"
                      type="button"
                      :aria-label="
                        accountCollapsed(account.id) ? 'Expand account' : 'Collapse account'
                      "
                      @click="toggleAccount(account.id)"
                    >
                      <span class="text-[10px]">{{
                        accountCollapsed(account.id) ? ">" : "v"
                      }}</span>
                    </button>
                    <button
                      class="min-w-0 flex-1 text-left"
                      type="button"
                      @click="selectAccountDefault(account)"
                    >
                      <span class="block min-w-0 truncate text-xs font-semibold">
                        {{ account.id }}
                      </span>
                      <span class="block truncate text-[11px] text-slate-500">{{
                        account.emailAddress
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
                    </div>
                  </div>
                </UContextMenu>
                <div v-if="!accountCollapsed(account.id)" class="mt-1 space-y-0.5">
                  <button
                    class="flex w-full items-center justify-between rounded-md px-6 py-1 text-left text-xs hover:bg-stone-200"
                    :class="
                      readerRoute.kind === 'unread' && readerRoute.accountId === account.id
                        ? 'bg-stone-200'
                        : ''
                    "
                    type="button"
                    @click="selectList(unreadPath(account.id))"
                  >
                    <span>Unread</span>
                    <UBadge
                      v-if="account.unreadCount > 0"
                      color="neutral"
                      size="sm"
                      variant="subtle"
                    >
                      {{ account.unreadCount }}
                    </UBadge>
                  </button>
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
              <div class="flex min-w-0 items-center gap-2 text-xs text-slate-500">
                <p class="min-w-0 flex-1 truncate">
                  <template v-if="readerRoute.kind === 'unread'">Unread Messages</template>
                  <template v-else-if="readerRoute.kind === 'mailbox' && selectedAccount">
                    {{ mailboxLabel(selectedAccount, readerRoute.mailboxId) }}
                  </template>
                  <template v-else-if="readerRoute.kind === 'search'"
                    >Search results for "{{ readerRoute.query }}"</template
                  >
                </p>
                <p v-if="selectedAccount" class="max-w-[45%] shrink-0 truncate text-right">
                  {{ selectedAccount.emailAddress }}
                </p>
              </div>
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
              >
                <template #actions>
                  <button
                    class="h-8 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
                    type="button"
                    @click="messageListQuery.refetch()"
                  >
                    Manual retry
                  </button>
                </template>
              </UAlert>
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
                  message.starred ? 'bg-amber-50' : '',
                  selectedMessageId === message.id ? 'bg-stone-200' : '',
                ]"
                type="button"
                @click="selectMessage(message.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-1">
                    <span v-if="message.starred" class="shrink-0 text-amber-500">★</span>
                    <span
                      class="truncate text-xs"
                      :class="message.unread ? 'font-bold text-slate-950' : 'font-medium'"
                    >
                      {{ senderLabel(message) }}
                    </span>
                  </div>
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
              </button>
              <div v-if="messageListNextCursor" class="p-3">
                <button
                  class="h-8 w-full rounded-md border border-stone-300 bg-stone-50 px-3 text-sm font-medium text-slate-700 hover:bg-stone-200 disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  :disabled="loadMoreMessagesMutation.isPending.value"
                  @click="loadMoreMessages"
                >
                  {{ loadMoreMessagesMutation.isPending.value ? "Loading..." : "Load more" }}
                </button>
                <button
                  v-if="failedLoadMore"
                  class="mt-2 h-8 w-full rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
                  type="button"
                  @click="loadMoreMessagesMutation.mutate(failedLoadMore)"
                >
                  Manual retry failed page
                </button>
              </div>
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
            <UAlert
              v-if="mailboxActionError"
              class="m-3"
              color="error"
              variant="soft"
              title="Mailbox action not confirmed"
              :description="mailboxActionError"
            />

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div v-if="messageDetailQuery.isLoading.value" class="p-6 text-sm text-slate-500">
                Loading message...
              </div>
              <div
                v-else-if="messageDetailQuery.isError.value"
                class="grid h-full place-items-center p-6 text-center text-sm text-slate-600"
              >
                <div>
                  <p>
                    Message {{ selectedMessageId }} is unavailable for account
                    {{ selectedAccountId }}.
                  </p>
                  <button
                    class="mt-3 h-8 rounded-md border border-stone-300 bg-white px-3 font-medium text-slate-900 hover:bg-stone-100"
                    type="button"
                    @click="messageDetailQuery.refetch()"
                  >
                    Manual retry
                  </button>
                </div>
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
                <div
                  v-if="
                    renderedMessage.blockedRemoteImageCount && !selectedMessageRemoteImagesAllowed
                  "
                  class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
                >
                  <div>
                    <p class="font-medium text-amber-950">Remote images are blocked</p>
                    <p class="mt-0.5 text-amber-800">
                      {{ renderedMessage.blockedRemoteImageCount }} remote image(s) blocked for
                      privacy.
                    </p>
                  </div>
                  <button
                    class="h-8 rounded-md border border-amber-300 bg-white px-3 text-sm font-medium text-amber-950 hover:bg-amber-100"
                    type="button"
                    @click="allowRemoteImagesForSelectedMessage"
                  >
                    Show images
                  </button>
                </div>
                <iframe
                  :key="selectedMessageKey"
                  class="message-body mt-6 block w-full"
                  sandbox="allow-popups"
                  :data-message-key="selectedMessageKey"
                  :srcdoc="renderedMessage.srcdoc"
                  title="Message body"
                  @load="markMessageBodyRendered"
                ></iframe>
                <div
                  v-if="selectedMessage.attachments.length"
                  class="mt-6 border-t border-stone-200 pt-4"
                >
                  <h2 class="text-sm font-semibold">Attachments</h2>
                  <UAlert
                    v-if="attachmentDownloadError"
                    class="mt-2"
                    color="error"
                    variant="soft"
                    title="Attachment download failed"
                  >
                    <template #actions>
                      <button
                        class="h-8 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
                        type="button"
                        @click="requestAttachmentDownload(attachmentDownloadError)"
                      >
                        Manual retry
                      </button>
                    </template>
                  </UAlert>
                  <ul class="mt-2 space-y-2">
                    <li
                      v-for="attachment in selectedMessage.attachments"
                      :key="attachment.id"
                      class="rounded-md border border-stone-200 px-3 py-2 text-sm"
                    >
                      <span>
                        {{ attachment.filename }} · {{ attachment.mimeType }} ·
                        {{ attachment.sizeBytes }} bytes
                      </span>
                      <button
                        class="ml-3 font-medium text-blue-700 hover:underline"
                        type="button"
                        :disabled="attachmentDownloadMutation.isPending.value"
                        @click="
                          requestAttachmentDownload({
                            accountId: selectedMessage.accountId,
                            messageId: selectedMessage.id,
                            attachmentId: attachment.id,
                            filename: attachment.filename,
                          })
                        "
                      >
                        {{
                          attachmentDownloadMutation.isPending.value ? "Downloading..." : "Download"
                        }}
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
