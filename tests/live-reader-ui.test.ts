import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe("Live reader UI", () => {
  const appVue = readFileSync(resolve("apps/web/src/App.vue"), "utf8");
  const mainCss = readFileSync(resolve("apps/web/src/assets/main.css"), "utf8");

  it("uses the approved warm-paper Reader palette", () => {
    expect(mainCss).toContain("--reader-canvas: #e9e6de");
    expect(mainCss).toContain("--reader-paper: #f1eee6");
    expect(mainCss).toContain("--reader-selected: #d6d1c6");
  });

  it("exposes current-Mailbox Manual refresh in the mobile Message list", () => {
    expect(appVue).toContain('aria-label="Refresh current mailbox"');
    expect(appVue).toContain("requestMailboxRefresh(readerRoute.accountId, readerRoute.mailboxId)");
    expect(appVue).toContain("Refresh failed. Retry");
  });

  it("keeps mobile navigation controls accessible and touchable", () => {
    expect(appVue).toContain('aria-label="Back to message list"');
    expect(appVue).toContain("max-lg:h-10 max-lg:w-10");
    expect(appVue).toContain("max-lg:min-h-10");
  });

  it("contains the Mailbox action error without overflowing the mobile viewport", () => {
    expect(appVue).toContain('<div v-if="mailboxActionError" class="px-3 pt-3 lg:contents">');
    expect(appVue).toContain('class="lg:m-3"');
  });

  it("shows the selected Mail account identity in the Message list header", () => {
    expect(appVue).toContain('class="max-w-[45%] shrink-0 truncate text-right"');
    expect(appVue).toContain("{{ selectedAccount.emailAddress }}");
  });

  it("formats Message dates as local YYYY-MM-DD HH:mm", () => {
    expect(appVue).toContain("function formatDate(value: string): string");
    expect(appVue).toContain("return `${year}-${month}-${day} ${hour}:${minute}`;");
  });

  it("renders Message lists one page at a time with explicit Load more", () => {
    expect(appVue).toContain("const liveMessageListPageSize = 50");
    expect(appVue).toContain("const messageListNextCursor = computed");
    expect(appVue).toContain("const loadMoreMessagesMutation = useMutation");
    expect(appVue).toContain("Load more");
  });

  it("shows Archive in the Message action toolbar", () => {
    expect(appVue).toContain('icon="i-lucide-archive"');
    expect(appVue).toContain("Archive");
  });

  it("visually distinguishes starred Messages and toggles the Star action", () => {
    expect(appVue).toContain("message.starred ? 'reader-message-starred' : ''");
    expect(appVue).toContain('v-if="message.starred"');
    expect(appVue).toContain("selectedMessage.starred ? 'i-lucide-star-off' : 'i-lucide-star'");
    expect(appVue).toContain('{{ selectedMessage.starred ? "Unstar" : "Star" }}');
  });

  it("persists only layout dimensions and starts Mailbox collapse state empty on reload", () => {
    expect(appVue).toContain("const collapsedAccounts = ref(new Set<string>())");
    expect(appVue).toContain("const collapsedMailboxGroups = ref(new Set<string>())");
    expect(appVue).not.toContain("savedReaderLayout.collapsedAccounts");
    expect(appVue).not.toContain("savedReaderLayout.collapsedMailboxGroups");
    expect(appVue).not.toContain("collapsedAccounts: [...collapsedAccounts.value]");
    expect(appVue).not.toContain("collapsedMailboxGroups: [...collapsedMailboxGroups.value]");
    expect(appVue).toContain("saveReaderLayout(navColumnWidth.value, listColumnWidth.value)");
  });

  it("starts the Gmail system Mailbox group collapsed when an account opens", () => {
    expect(appVue).toContain('mailboxKey(openedAccount.id, "[Gmail]")');
  });
});
