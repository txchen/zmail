import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Sync jobs UI", () => {
  const appVue = readFileSync(resolve("apps/web/src/App.vue"), "utf8");

  it("spins the top bar Sync jobs icon while jobs are active", () => {
    expect(appVue).toContain(
      `const activeSyncJobs = computed(() =>
  syncJobs.value.filter((job) => job.state === "pending" || job.state === "running"),
);`,
    );
    expect(appVue).toMatch(
      /v-if="activeSyncJobs\.length > 0"[\s\S]*icon="i-lucide-loader-circle"[\s\S]*:ui="\{ leadingIcon: 'animate-spin' \}"/,
    );
  });

  it("shows finished Sync job durations in the popover", () => {
    expect(appVue).toContain("function syncJobDuration(job: SyncJobRecord): string");
    expect(appVue).toContain("function syncJobStateIcon(job: SyncJobRecord): string");
    expect(appVue).toContain("function syncJobScopeLabel(job: SyncJobRecord): string");
    expect(appVue).toContain("function syncJobOriginLabel(job: SyncJobRecord): string");
    expect(appVue).toContain('job.origin === "automatic" ? "⟳" : "👤"');
    expect(appVue).toContain("function syncJobTime(job: SyncJobRecord): string");
    expect(appVue).toContain("job.result?.durationMs");
    expect(appVue).toMatch(
      /job\.startedAt && job\.finishedAt[\s\S]*new Date\(job\.finishedAt\)\.getTime\(\) - new Date\(job\.startedAt\)\.getTime\(\)[\s\S]*: job\.result\?\.durationMs/,
    );
    expect(appVue).toContain("{{ syncJobTime(job) }}");
    expect(appVue).toContain("{{ syncJobOriginLabel(job) }}");
    expect(appVue).toContain("{{ syncJobSummary(job) }}");
    expect(appVue).not.toContain("{{ job.state }}");
    expect(appVue).not.toContain('class="mt-1 truncate text-slate-600"');
    expect(appVue).toContain("const displayedSyncJobs = computed(() => {");
    expect(appVue).toContain("{{ displayedSyncJobs.length }} shown");
    expect(appVue).toContain('v-for="job in displayedSyncJobs"');
  });

  it("dismisses the Sync jobs popover on outside click", () => {
    expect(appVue).toContain('ref="syncJobsMenu"');
    expect(appVue).toContain("function dismissSyncJobsOnOutsidePointer(event: PointerEvent): void");
    expect(appVue).toContain(
      'document.addEventListener("pointerdown", dismissSyncJobsOnOutsidePointer)',
    );
    expect(appVue).toContain(
      'document.removeEventListener("pointerdown", dismissSyncJobsOnOutsidePointer)',
    );
  });

  it("keeps long Sync job histories scrollable", () => {
    expect(appVue).toContain("max-h-[32rem]");
    expect(appVue).toContain("overflow-y-auto");
  });

  it("polls Sync jobs faster while work is active", () => {
    expect(appVue).toContain("refetchInterval: syncJobsPollingInterval");
    expect(appVue).toMatch(
      /job\.state === "pending" \|\| job\.state === "running"[\s\S]*return hasActiveJob \? 1_000 : 15_000/,
    );
  });

  it("does not show Account sync status labels in the account tree", () => {
    expect(appVue).not.toContain("accountSyncStatusLabel");
  });

  it("shows the selected Account email in the message list header", () => {
    expect(appVue).toContain('class="max-w-[45%] shrink-0 truncate text-right"');
    expect(appVue).toContain("{{ selectedAccount.emailAddress }}");
  });

  it("lets the App user schedule custom range Sync jobs from the account context menu", () => {
    expect(appVue).toContain("function accountContextMenuItems(account: MailAccountMailboxTree)");
    expect(appVue).toContain('<UContextMenu :items="accountContextMenuItems(account)">');
    expect(appVue).toContain('label: "Sync now"');
    expect(appVue).toContain("onSelect: () => syncJobMutation.mutate({ accountId: account.id })");
    expect(appVue).toContain("function submitCustomSync()");
    expect(appVue).toContain(
      "syncJobMutation.mutate({ accountId: customSyncAccountId.value, days: customSyncDays.value })",
    );
    expect(appVue).toContain("<UModal");
    expect(appVue).toContain("<USelect");
    expect(appVue).toContain('@submit.prevent="submitCustomSync"');
    expect(appVue).toContain('type="submit"');
    expect(appVue).toContain("Start sync");
    expect(appVue).not.toContain('aria-label="Sync message range"');
    expect(appVue).not.toContain('aria-label="Refresh account"');
  });

  it("formats message dates as local YYYY-MM-DD HH:mm", () => {
    expect(appVue).toContain("function formatDate(value: string): string");
    expect(appVue).toContain("return `${year}-${month}-${day} ${hour}:${minute}`;");
    expect(appVue).not.toContain('month: "short"');
  });

  it("renders message lists one page at a time with Load more", () => {
    expect(appVue).toContain("const liveMessageListPageSize = 50");
    expect(appVue).toContain("const messageListNextCursor = computed");
    expect(appVue).toContain("const loadMoreMessagesMutation = useMutation");
    expect(appVue).toContain("Load more");
  });

  it("shows Archive in the message action toolbar", () => {
    expect(appVue).toContain('icon="i-lucide-archive"');
    expect(appVue).toContain("Archive");
  });

  it("visually distinguishes starred messages and toggles the Star action", () => {
    expect(appVue).toContain("message.starred ? 'bg-amber-50' : ''");
    expect(appVue).toContain('v-if="message.starred"');
    expect(appVue).toContain("★");
    expect(appVue).toContain("selectedMessage.starred ? 'i-lucide-star-off' : 'i-lucide-star'");
    expect(appVue).toContain('{{ selectedMessage.starred ? "Unstar" : "Star" }}');
  });
});
