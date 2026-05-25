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
    expect(appVue).toContain("function syncJobTime(job: SyncJobRecord): string");
    expect(appVue).toContain("job.result?.durationMs");
    expect(appVue).toMatch(
      /job\.startedAt && job\.finishedAt[\s\S]*new Date\(job\.finishedAt\)\.getTime\(\) - new Date\(job\.startedAt\)\.getTime\(\)[\s\S]*: job\.result\?\.durationMs/,
    );
    expect(appVue).toContain("{{ syncJobTime(job) }}");
    expect(appVue).toContain("{{ syncJobScopeLabel(job) }} · {{ job.state }}");
    expect(appVue).toContain("{{ syncJobs.length }} total");
  });

  it("dismisses the Sync jobs popover on outside click", () => {
    expect(appVue).toContain('ref="syncJobsMenu"');
    expect(appVue).toContain("function dismissSyncJobsOnOutsidePointer(event: PointerEvent): void");
    expect(appVue).toContain('document.addEventListener("pointerdown", dismissSyncJobsOnOutsidePointer)');
    expect(appVue).toContain('document.removeEventListener("pointerdown", dismissSyncJobsOnOutsidePointer)');
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
  });

  it("formats message dates as local YYYY-MM-DD HH:mm", () => {
    expect(appVue).toContain("function formatDate(value: string): string");
    expect(appVue).toContain("return `${year}-${month}-${day} ${hour}:${minute}`;");
    expect(appVue).not.toContain('month: "short"');
  });

  it("renders message lists one page at a time with Load more", () => {
    expect(appVue).toContain("const messageListPageSize = 100");
    expect(appVue).toContain("const messageListNextCursor = computed");
    expect(appVue).toContain("const loadMoreMessagesMutation = useMutation");
    expect(appVue).toContain("Load more");
  });

  it("does not show Archive in the message action toolbar", () => {
    expect(appVue).not.toContain('icon="i-lucide-archive"');
    expect(appVue).not.toContain(">Archive");
  });
});
