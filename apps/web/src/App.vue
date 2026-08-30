<script setup lang="ts">
import type {
  LiveMailAccount,
  LiveMessageDetail,
  LiveMessageSummary,
  MailAccountSummary,
  LiveMessagePage,
  MailboxAction,
  MailboxSummary,
} from "@zmail/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchHealth,
  downloadAttachment,
  fetchInlineResource,
  fetchMailAccounts,
  fetchMessage,
  fetchMessagesForMailbox,
  fetchSession,
  fetchUnreadMessagesForAccount,
  login,
  logout,
  openMailAccount,
  performMailboxAction,
  refreshMailAccount,
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
import { createInlineMessageResourceController } from "./inline-message-resource-controller";
import { renderReadableMessage } from "./message-rendering";
import {
  applyConfirmedAccountCounts,
  confirmationRemovesSourceView,
  createMailboxActionController,
} from "./mailbox-action-controller";
import { confirmedRenderedMessageKey, createReadDwellController } from "./read-dwell";
import { readSavedReaderLayout, saveReaderLayout } from "./reader-layout";
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
const openedMailAccounts = ref(new Map<string, LiveMailAccount>());
const openingAccountIds = ref(new Set<string>());
const accountOpenErrorIds = ref(new Set<string>());
const accountOpenDestinationId = ref("");
let accountOpenGeneration = 0;
const savedReaderLayout = readSavedReaderLayout();
const navColumnWidth = ref(savedReaderLayout.navColumnWidth);
const listColumnWidth = ref(savedReaderLayout.listColumnWidth);
const collapsedAccounts = ref(new Set<string>());
const collapsedMailboxGroups = ref(new Set<string>());
const activeResize = ref<"nav" | "list" | null>(null);
const documentVisible = ref(
  typeof document === "undefined" ? true : document.visibilityState !== "hidden",
);
const windowFocused = ref(typeof document === "undefined" ? true : document.hasFocus());
const renderedBodyMessageKey = ref("");
const inlineResourceDataUrls = ref(new Map<string, string>());
const inlineResourceFailures = ref(new Map<string, { resourceId: string }>());
const mailboxActionError = ref("");
type ManualRefreshVariables = {
  accountId: string;
  request: {
    view: { kind: "mailbox"; mailboxId: string };
    selectedMessageId?: string;
  };
};
const failedManualRefreshes = ref(new Map<string, ManualRefreshVariables>());
const refreshingMailboxKeys = ref(new Set<string>());
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

type ReaderShellMailAccount = MailAccountSummary & {
  opened?: LiveMailAccount;
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

const configuredMailAccounts = computed(() => mailAccountsQuery.data.value?.mailAccounts ?? []);
const readDwellSeconds = computed(
  () => mailAccountsQuery.data.value?.reader?.readDwellSeconds ?? 3,
);
const readerShellMailAccounts = computed<ReaderShellMailAccount[]>(() =>
  configuredMailAccounts.value.map((account) => ({
    ...account,
    opened: openedMailAccounts.value.get(account.id),
  })),
);
const readerRoute = computed(() => parseReaderRoute(route.path, route.query));
const selectedAccountId = computed(() =>
  readerRoute.value.kind === "none" ? "" : readerRoute.value.accountId,
);
const selectedAccount = computed(() => openedMailAccounts.value.get(selectedAccountId.value));
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
const failedInlineResources = computed(() => [...inlineResourceFailures.value.values()]);

const renderedMessage = computed(() => {
  if (!selectedMessage.value) {
    return null;
  }

  return renderReadableMessage({
    accountId: selectedMessage.value.accountId,
    messageId: selectedMessage.value.id,
    applicationOrigin: window.location.origin,
    readableBody: selectedMessage.value.readableBody,
    plainTextBody: selectedMessage.value.plainTextBody,
    inlineResources: selectedMessage.value.inlineResources.map((resource) => ({
      ...resource,
      url: inlineResourceDataUrls.value.get(resource.id) ?? "data:,",
    })),
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
    inlineResourceController.cancel();
    loggedOut.value = true;
    accountOpenGeneration += 1;
    openedMailAccounts.value = new Map();
    openingAccountIds.value = new Set();
    accountOpenErrorIds.value = new Set();
    accountOpenDestinationId.value = "";
    remoteImagesAllowedMessageKeys.value = new Set();
    lastListRouteByAccount.value = new Map();
    searchDraft.value = "";
    failedManualRefreshes.value = new Map();
    refreshingMailboxKeys.value = new Set();
    attachmentDownloadError.value = null;
    failedLoadMore.value = null;
    mailboxActionError.value = "";
    renderedBodyMessageKey.value = "";
    queryClient.clear();
    queryClient.setQueryData(["session"], { authenticated: false });
    await router.push("/");
  },
});

const manualRefreshMutation = useMutation({
  mutationFn: async ({ accountId, request }: ManualRefreshVariables) => {
    const response = await refreshMailAccount(accountId, request);
    return { accountId, response };
  },
  onSuccess: async ({ accountId, response }, variables) => {
    const nextFailures = new Map(failedManualRefreshes.value);
    nextFailures.delete(manualRefreshKey(variables));
    failedManualRefreshes.value = nextFailures;
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
      response.mailAccount,
    );
    cacheManualRefresh(queryClient, accountId, response);
  },
  onError: (_error, variables) => {
    failedManualRefreshes.value = new Map(failedManualRefreshes.value).set(
      manualRefreshKey(variables),
      variables,
    );
  },
  onSettled: (_data, _error, variables) => {
    setMailboxRefreshing(variables, false);
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

const inlineResourceController = createInlineMessageResourceController({
  fetchResource: (accountId, messageId, resourceId, signal) =>
    fetchInlineResource(accountId, messageId, resourceId, fetch, signal),
  toDataUrl: blobDataUrl,
  onStateChange: (state) => {
    inlineResourceDataUrls.value = new Map(state.dataUrls);
    inlineResourceFailures.value = new Map(state.failures);
  },
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

watch([selectedAccountId, selectedMessageId], () => {
  renderedBodyMessageKey.value = "";
});

watch(
  selectedMessage,
  (message) => {
    void inlineResourceController.select(message);
  },
  { immediate: true },
);

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
  inlineResourceController.cancel();
  document.removeEventListener("visibilitychange", updateDocumentVisible);
  window.removeEventListener("focus", updateWindowFocus);
  window.removeEventListener("blur", updateWindowFocus);
  readDwellController.cancel();
});

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Inline message resource could not be read")),
    );
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Inline message resource could not be read")),
    );
    reader.readAsDataURL(blob);
  });
}

onMounted(() => {
  void router.replace("/");
  saveReaderLayout(navColumnWidth.value, listColumnWidth.value);
  document.addEventListener("visibilitychange", updateDocumentVisible);
  window.addEventListener("focus", updateWindowFocus);
  window.addEventListener("blur", updateWindowFocus);
});

async function submitLogin() {
  await loginMutation.mutateAsync();
}

async function selectList(path: string) {
  accountOpenDestinationId.value = "";
  await router.push(path);
  mobilePane.value = "list";
}

async function selectMessage(messageId: string) {
  accountOpenDestinationId.value = "";
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

function accountCollapsed(account: ReaderShellMailAccount): boolean {
  return !account.opened || collapsedAccounts.value.has(account.id);
}

function toggleAccount(account: ReaderShellMailAccount) {
  if (!account.opened) {
    openConfiguredAccount(account);
    return;
  }

  collapsedAccounts.value = toggledSet(collapsedAccounts.value, account.id);
}

function mailboxKey(accountId: string, mailboxId: string): string {
  return `${accountId}:${mailboxId}`;
}

function updateDocumentVisible(): void {
  documentVisible.value = document.visibilityState !== "hidden";
}

function updateWindowFocus(): void {
  windowFocused.value = document.hasFocus();
}

function mailboxContextMenuItems(accountId: string, mailbox: MailboxSummary) {
  return [
    {
      label: "Refresh",
      icon: "i-lucide-refresh-cw",
      disabled: mailboxRefreshing(accountId, mailbox.id),
      onSelect: () => requestMailboxRefresh(accountId, mailbox.id),
    },
  ];
}

function mailboxGroupCollapsed(accountId: string, mailboxId: string): boolean {
  return collapsedMailboxGroups.value.has(mailboxKey(accountId, mailboxId));
}

function toggleMailboxGroup(accountId: string, mailboxId: string) {
  collapsedMailboxGroups.value = toggledSet(
    collapsedMailboxGroups.value,
    mailboxKey(accountId, mailboxId),
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

function visibleMailboxRows(account: LiveMailAccount): VisibleMailboxRow[] {
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
    key: mailboxKey(accountId, node.id),
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

function senderLabel(message: LiveMessageSummary): string {
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

function mailboxLabel(account: LiveMailAccount, mailboxId: string): string {
  return account.mailboxes.find((mailbox) => mailbox.id === mailboxId)?.name ?? mailboxId;
}

function accountDefaultPath(account: LiveMailAccount): string | undefined {
  return defaultReaderPath([account]);
}

async function selectAccountDefault(account: LiveMailAccount) {
  const path = accountDefaultPath(account);

  if (path) {
    await selectList(path);
  }
}

async function selectReaderShellAccount(account: ReaderShellMailAccount) {
  if (!account.opened) {
    openConfiguredAccount(account);
    return;
  }

  const nextCollapsedAccounts = new Set(collapsedAccounts.value);
  nextCollapsedAccounts.delete(account.id);
  collapsedAccounts.value = nextCollapsedAccounts;
  await selectAccountDefault(account.opened);
}

async function openConfiguredAccount(account: MailAccountSummary): Promise<void> {
  if (openingAccountIds.value.has(account.id)) {
    return;
  }

  accountOpenDestinationId.value = account.id;
  const requestGeneration = accountOpenGeneration;
  openingAccountIds.value = new Set(openingAccountIds.value).add(account.id);
  const nextErrors = new Set(accountOpenErrorIds.value);
  nextErrors.delete(account.id);
  accountOpenErrorIds.value = nextErrors;

  try {
    const response = await openMailAccount(account.id);
    if (requestGeneration !== accountOpenGeneration) {
      return;
    }

    const openedAccount = response.mailAccount;
    openedMailAccounts.value = new Map(openedMailAccounts.value).set(
      openedAccount.id,
      openedAccount,
    );
    const nextCollapsedAccounts = new Set(collapsedAccounts.value);
    nextCollapsedAccounts.delete(openedAccount.id);
    collapsedAccounts.value = nextCollapsedAccounts;
    if (openedAccount.mailboxes.some((mailbox) => mailbox.id.startsWith("[Gmail]/"))) {
      collapsedMailboxGroups.value = new Set(collapsedMailboxGroups.value).add(
        mailboxKey(openedAccount.id, "[Gmail]"),
      );
    }
    const inboxRoute = {
      kind: "mailbox" as const,
      accountId: openedAccount.id,
      mailboxId: response.inbox.mailboxId,
    };

    queryClient.setQueryData(liveMessageListKey(inboxRoute), {
      messages: response.inbox.messages,
      ...(response.inbox.nextCursor ? { nextCursor: response.inbox.nextCursor } : {}),
    });

    if (accountOpenDestinationId.value === account.id) {
      await router.push(mailboxPath(openedAccount.id, response.inbox.mailboxId));
    }
  } catch {
    if (requestGeneration === accountOpenGeneration) {
      accountOpenErrorIds.value = new Set(accountOpenErrorIds.value).add(account.id);
    }
  } finally {
    if (requestGeneration === accountOpenGeneration) {
      const nextOpeningAccounts = new Set(openingAccountIds.value);
      nextOpeningAccounts.delete(account.id);
      openingAccountIds.value = nextOpeningAccounts;
    }
  }
}

function accountOpening(accountId: string): boolean {
  return openingAccountIds.value.has(accountId);
}

function retryAccountOpen(account: MailAccountSummary): void {
  void openConfiguredAccount(account);
}

function mailboxRefreshRequest(accountId: string, mailboxId: string): ManualRefreshVariables {
  const current = readerRoute.value;

  return {
    accountId,
    request: {
      view: { kind: "mailbox", mailboxId },
      ...(current.kind === "mailbox" &&
      current.accountId === accountId &&
      current.mailboxId === mailboxId &&
      current.messageId
        ? { selectedMessageId: current.messageId }
        : {}),
    },
  };
}

function manualRefreshKey(variables: ManualRefreshVariables): string {
  return mailboxKey(variables.accountId, variables.request.view.mailboxId);
}

function mailboxRefreshing(accountId: string, mailboxId: string): boolean {
  return refreshingMailboxKeys.value.has(mailboxKey(accountId, mailboxId));
}

function failedMailboxRefresh(
  accountId: string,
  mailboxId: string,
): ManualRefreshVariables | undefined {
  return failedManualRefreshes.value.get(mailboxKey(accountId, mailboxId));
}

function setMailboxRefreshing(variables: ManualRefreshVariables, refreshing: boolean): void {
  const nextRefreshingMailboxes = new Set(refreshingMailboxKeys.value);
  const key = manualRefreshKey(variables);
  if (refreshing) {
    nextRefreshingMailboxes.add(key);
  } else {
    nextRefreshingMailboxes.delete(key);
  }
  refreshingMailboxKeys.value = nextRefreshingMailboxes;
}

function requestMailboxRefresh(accountId: string, mailboxId: string): void {
  const variables = mailboxRefreshRequest(accountId, mailboxId);
  const key = manualRefreshKey(variables);
  if (refreshingMailboxKeys.value.has(key)) {
    return;
  }

  const nextFailures = new Map(failedManualRefreshes.value);
  nextFailures.delete(key);
  failedManualRefreshes.value = nextFailures;
  setMailboxRefreshing(variables, true);
  manualRefreshMutation.mutate(variables);
}

function retryManualRefresh(failed: ManualRefreshVariables): void {
  if (!refreshingMailboxKeys.value.has(manualRefreshKey(failed))) {
    const nextFailures = new Map(failedManualRefreshes.value);
    nextFailures.delete(manualRefreshKey(failed));
    failedManualRefreshes.value = nextFailures;
    setMailboxRefreshing(failed, true);
    manualRefreshMutation.mutate(failed);
  }
}

function retryMailboxRefresh(accountId: string, mailboxId: string): void {
  const failed = failedMailboxRefresh(accountId, mailboxId);
  if (failed) {
    retryManualRefresh(failed);
  }
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
</script>

<template>
  <main class="reader-theme min-h-screen">
    <section
      v-if="!authenticated"
      class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6"
    >
      <div class="mb-8">
        <h1 class="text-3xl font-semibold tracking-normal">ZMail</h1>
        <p class="reader-muted mt-3 text-sm">
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
          class="reader-button flex h-11 w-32 items-center justify-center rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="loginMutation.isPending.value"
          type="submit"
        >
          {{ loginMutation.isPending.value ? "Logging in..." : "Log in" }}
        </button>
      </form>
    </section>

    <section v-else class="reader-panel flex h-screen min-h-0 flex-col">
      <header
        class="reader-border reader-chrome flex h-10 shrink-0 items-center justify-between border-b px-3"
      >
        <div class="min-w-0">
          <button class="text-sm font-semibold" type="button" @click="router.push('/')">
            ZMail
          </button>
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

      <div class="reader-grid grid min-h-0 flex-1 grid-cols-1" :style="readerGridStyle">
        <aside
          class="reader-border reader-panel min-h-0 border-r"
          :class="mobilePane === 'nav' ? 'block' : 'hidden lg:block'"
          aria-label="Account mailbox tree"
        >
          <div class="flex h-full flex-col">
            <div class="min-h-0 flex-1 overflow-y-auto p-2">
              <p v-if="readerShellMailAccounts.length === 0" class="reader-muted px-2 py-3 text-xs">
                No Mail accounts are configured.
              </p>
              <div v-for="account in readerShellMailAccounts" :key="account.id" class="mb-3">
                <div class="flex items-start justify-between gap-1">
                  <button
                    class="reader-muted reader-hover mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded max-lg:mt-0 max-lg:h-10 max-lg:w-10"
                    type="button"
                    :disabled="accountOpening(account.id)"
                    :aria-label="accountCollapsed(account) ? 'Expand account' : 'Collapse account'"
                    @click="toggleAccount(account)"
                  >
                    <span class="text-[10px]">{{ accountCollapsed(account) ? ">" : "v" }}</span>
                  </button>
                  <button
                    class="min-w-0 flex-1 text-left max-lg:min-h-10"
                    type="button"
                    :disabled="accountOpening(account.id)"
                    :aria-label="
                      account.opened
                        ? `Open Inbox for account ${account.id}`
                        : `Open account ${account.id}`
                    "
                    @click="selectReaderShellAccount(account)"
                  >
                    <span class="block min-w-0 truncate text-xs font-semibold">
                      {{ account.id }}
                    </span>
                    <span class="reader-muted block truncate text-[11px]">{{
                      account.emailAddress
                    }}</span>
                    <span v-if="accountOpening(account.id)" class="reader-muted block text-[11px]">
                      Opening...
                    </span>
                  </button>
                  <div class="flex shrink-0 items-center gap-1">
                    <UBadge
                      v-if="account.opened && account.opened.unreadCount > 0"
                      color="neutral"
                      size="sm"
                      variant="subtle"
                      >{{ account.opened.unreadCount }}</UBadge
                    >
                  </div>
                </div>
                <UAlert
                  v-if="accountOpenErrorIds.has(account.id)"
                  class="mt-2"
                  color="error"
                  variant="soft"
                  title="Mail account unavailable"
                  :description="`Could not open ${account.id}. Choose another account or retry.`"
                >
                  <template #actions>
                    <button
                      class="h-8 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
                      type="button"
                      :disabled="accountOpening(account.id)"
                      @click="retryAccountOpen(account)"
                    >
                      Manual retry
                    </button>
                  </template>
                </UAlert>
                <div v-if="account.opened && !accountCollapsed(account)" class="mt-1 space-y-0.5">
                  <button
                    class="reader-hover flex w-full items-center justify-between rounded-md px-6 py-1 text-left text-xs max-lg:min-h-10"
                    :class="
                      readerRoute.kind === 'unread' && readerRoute.accountId === account.id
                        ? 'reader-selected'
                        : ''
                    "
                    type="button"
                    @click="selectList(unreadPath(account.id))"
                  >
                    <span>Unread</span>
                    <UBadge
                      v-if="account.opened.unreadCount > 0"
                      color="neutral"
                      size="sm"
                      variant="subtle"
                    >
                      {{ account.opened.unreadCount }}
                    </UBadge>
                  </button>
                  <UContextMenu
                    v-for="row in visibleMailboxRows(account.opened)"
                    :key="row.key"
                    :items="row.mailbox ? mailboxContextMenuItems(account.id, row.mailbox) : []"
                  >
                    <div>
                      <div
                        class="reader-hover group flex items-center gap-1 rounded-md py-1 text-xs max-lg:min-h-10 max-lg:py-0"
                        :class="
                          readerRoute.kind === 'mailbox' &&
                          readerRoute.accountId === account.id &&
                          row.mailbox &&
                          readerRoute.mailboxId === row.mailbox.id
                            ? 'reader-selected'
                            : ''
                        "
                        :style="{ paddingLeft: `${row.depth * 12 + 2}px`, paddingRight: '6px' }"
                      >
                        <button
                          v-if="row.hasChildren"
                          class="reader-muted reader-hover grid h-4 w-4 shrink-0 place-items-center rounded max-lg:h-10 max-lg:w-10"
                          type="button"
                          :aria-label="
                            row.collapsed ? 'Expand mailbox group' : 'Collapse mailbox group'
                          "
                          @click.stop="toggleMailboxGroup(account.id, row.id)"
                        >
                          <span class="text-[9px]">{{ row.collapsed ? ">" : "v" }}</span>
                        </button>
                        <span v-else class="h-4 w-4 shrink-0 max-lg:h-10 max-lg:w-10"></span>
                        <button
                          class="flex min-w-0 flex-1 items-center gap-2 truncate text-left max-lg:min-h-10"
                          :class="row.mailbox ? '' : 'reader-muted font-medium'"
                          type="button"
                          :aria-label="
                            row.mailbox
                              ? `Open mailbox ${row.mailbox.id} for account ${account.id}`
                              : undefined
                          "
                          @click="
                            row.mailbox
                              ? selectList(mailboxPath(account.id, row.mailbox.id))
                              : toggleMailboxGroup(account.id, row.id)
                          "
                        >
                          <span class="truncate">{{ row.label }}</span>
                          <span
                            v-if="row.mailbox && mailboxRefreshing(account.id, row.mailbox.id)"
                            class="reader-muted shrink-0 text-[11px]"
                          >
                            Refreshing...
                          </span>
                        </button>
                        <UBadge
                          v-if="row.unreadCount > 0"
                          color="neutral"
                          size="sm"
                          variant="subtle"
                          >{{ row.unreadCount }}</UBadge
                        >
                      </div>
                      <div
                        v-if="row.mailbox && failedMailboxRefresh(account.id, row.mailbox.id)"
                        class="ml-6 flex items-center gap-2 px-1 pb-1 text-[11px] text-red-700"
                      >
                        <span>Refresh failed.</span>
                        <button
                          class="font-medium underline"
                          type="button"
                          :disabled="mailboxRefreshing(account.id, row.mailbox.id)"
                          @click.stop="retryMailboxRefresh(account.id, row.mailbox.id)"
                        >
                          Manual retry
                        </button>
                      </div>
                    </div>
                  </UContextMenu>
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
          class="reader-border reader-panel min-h-0 border-r"
          :class="mobilePane === 'list' ? 'block' : 'hidden lg:block'"
          aria-label="Message list"
        >
          <div class="flex h-full flex-col">
            <div class="reader-border reader-panel space-y-2 border-b p-2">
              <div class="flex items-center gap-2 lg:hidden">
                <UButton
                  aria-label="Account mailbox tree"
                  color="neutral"
                  icon="i-lucide-menu"
                  square
                  variant="ghost"
                  @click="mobilePane = 'nav'"
                />
                <span class="flex-1 text-sm font-medium">Messages</span>
                <UButton
                  v-if="readerRoute.kind === 'mailbox'"
                  aria-label="Refresh current mailbox"
                  color="neutral"
                  icon="i-lucide-refresh-cw"
                  :loading="mailboxRefreshing(readerRoute.accountId, readerRoute.mailboxId)"
                  square
                  variant="ghost"
                  @click="requestMailboxRefresh(readerRoute.accountId, readerRoute.mailboxId)"
                />
              </div>
              <form class="flex gap-2" @submit.prevent="submitSearch">
                <UInput
                  v-model="searchDraft"
                  class="reader-search-input min-w-0 flex-1"
                  :disabled="!selectedAccount"
                  icon="i-lucide-search"
                  placeholder="Search this account"
                />
                <button
                  class="reader-button h-8 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!selectedAccount"
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
              <button
                v-if="
                  readerRoute.kind === 'mailbox' &&
                  failedMailboxRefresh(readerRoute.accountId, readerRoute.mailboxId)
                "
                class="text-left text-xs font-medium text-red-700 lg:hidden"
                type="button"
                :disabled="mailboxRefreshing(readerRoute.accountId, readerRoute.mailboxId)"
                @click="retryMailboxRefresh(readerRoute.accountId, readerRoute.mailboxId)"
              >
                Refresh failed. Retry
              </button>
              <div class="reader-muted flex min-w-0 items-center gap-2 text-xs">
                <p class="min-w-0 flex-1 truncate">
                  <template v-if="readerRoute.kind === 'unread'">Unread Messages</template>
                  <template v-else-if="readerRoute.kind === 'mailbox' && selectedAccount">
                    {{ mailboxLabel(selectedAccount, readerRoute.mailboxId) }}
                  </template>
                  <template v-else-if="readerRoute.kind === 'search'"
                    >Search results for "{{ readerRoute.query }}"</template
                  >
                  <template v-else>Select a Mail account</template>
                </p>
                <p v-if="selectedAccount" class="max-w-[45%] shrink-0 truncate text-right">
                  {{ selectedAccount.emailAddress }}
                </p>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div v-if="messageListQuery.isLoading.value" class="reader-muted p-4 text-sm">
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
              <div v-else-if="messages.length === 0" class="reader-muted p-6 text-sm">
                {{
                  selectedAccount
                    ? "No messages in this view."
                    : "Select a Mail account from the left."
                }}
              </div>
              <button
                v-for="message in messages"
                v-else
                :key="message.id"
                class="reader-border reader-hover block w-full border-b px-3 py-2 text-left"
                :class="[
                  message.unread
                    ? 'reader-message-unread border-l-4'
                    : 'reader-message-read border-l-4',
                  message.starred ? 'reader-message-starred' : '',
                  selectedMessageId === message.id ? 'reader-selected' : '',
                ]"
                type="button"
                @click="selectMessage(message.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-1">
                    <span v-if="message.starred" class="shrink-0 text-amber-500">★</span>
                    <span
                      class="truncate text-xs"
                      :class="message.unread ? 'font-bold' : 'font-medium'"
                    >
                      {{ senderLabel(message) }}
                    </span>
                  </div>
                  <span class="reader-muted shrink-0 text-[11px]">{{
                    formatDate(message.receivedAt)
                  }}</span>
                </div>
                <p
                  class="mt-0.5 truncate text-xs"
                  :class="message.unread ? 'font-bold' : 'reader-muted'"
                >
                  {{ message.subject || "(No subject)" }}
                </p>
              </button>
              <div v-if="messageListNextCursor" class="p-3">
                <button
                  class="reader-border reader-paper reader-hover reader-muted h-8 w-full rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
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
          class="reader-paper min-h-0"
          :class="mobilePane === 'message' ? 'block' : 'hidden lg:block'"
          aria-label="Message content"
        >
          <div class="flex h-full flex-col">
            <div
              class="reader-border reader-panel flex h-12 shrink-0 items-center gap-2 border-b px-3"
            >
              <UButton
                class="lg:hidden"
                aria-label="Back to message list"
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
            <div v-if="mailboxActionError" class="px-3 pt-3 lg:contents">
              <UAlert
                class="lg:m-3"
                color="error"
                variant="soft"
                title="Mailbox action not confirmed"
                :description="mailboxActionError"
              />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <div v-if="messageDetailQuery.isLoading.value" class="reader-muted p-6 text-sm">
                Loading message...
              </div>
              <div
                v-else-if="messageDetailQuery.isError.value"
                class="reader-muted grid h-full place-items-center p-6 text-center text-sm"
              >
                <div>
                  <p>
                    Message {{ selectedMessageId }} is unavailable for account
                    {{ selectedAccountId }}.
                  </p>
                  <button
                    class="reader-border reader-paper reader-hover mt-3 h-8 rounded-md border px-3 font-medium"
                    type="button"
                    @click="messageDetailQuery.refetch()"
                  >
                    Manual retry
                  </button>
                </div>
              </div>
              <div
                v-else-if="!selectedMessage"
                class="reader-muted grid h-full place-items-center p-6 text-center text-sm"
              >
                Select a Message to read.
              </div>
              <div v-else-if="renderedMessage" class="mx-auto max-w-4xl px-5 py-6">
                <h1 class="text-2xl font-semibold tracking-normal">
                  {{ selectedMessage.subject || "(No subject)" }}
                </h1>
                <div class="reader-muted mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span>{{ senderLabel(selectedMessage) }}</span>
                  <span>{{ selectedMessage.sender.address }}</span>
                  <span>{{ formatDate(selectedMessage.receivedAt) }}</span>
                </div>
                <div v-if="selectedMessage.recipients.length" class="reader-muted mt-1 text-sm">
                  <span class="font-medium">To</span>
                  {{ participantsLabel(selectedMessage.recipients) }}
                </div>
                <div v-if="selectedMessage.ccRecipients.length" class="reader-muted mt-1 text-sm">
                  <span class="font-medium">Cc</span>
                  {{ participantsLabel(selectedMessage.ccRecipients) }}
                </div>
                <div v-if="selectedMessage.bccRecipients.length" class="reader-muted mt-1 text-sm">
                  <span class="font-medium">Bcc</span>
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
                <UAlert
                  v-for="failure in failedInlineResources"
                  :key="failure.resourceId"
                  class="mt-4"
                  color="error"
                  variant="soft"
                  title="Inline message resource unavailable"
                  :description="`Message ${selectedMessage.id} resource ${failure.resourceId} failed to load.`"
                >
                  <template #actions>
                    <button
                      class="h-8 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-900"
                      type="button"
                      @click="inlineResourceController.retry(failure.resourceId)"
                    >
                      Manual retry
                    </button>
                  </template>
                </UAlert>
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
