import { spawn } from "node:child_process";

const webUrl = process.env.ZMAIL_SMOKE_WEB_URL ?? "http://localhost:3001";
const apiUrl = process.env.ZMAIL_SMOKE_API_URL ?? "http://localhost:3001";
const browserBin = process.env.ZMAIL_SMOKE_BROWSER_BIN ?? "npx";
const browserPrefix = process.env.ZMAIL_SMOKE_BROWSER_BIN ? [] : ["--yes", "agent-browser"];
const session = `zmail-live-reader-${Date.now()}`;
const children = [];

try {
  await execFile("./node_modules/.bin/vite", ["build", "apps/web"]);
  if (!(await isReachable(`${apiUrl}/api/health`))) {
    children.push(
      start("./node_modules/.bin/tsx", ["scripts/smoke-live-reader-server.ts"], "fake-api"),
    );
  }
  await waitFor(
    async () => (await isReachable(webUrl)) && (await isReachable(`${apiUrl}/api/health`)),
    "Smoke servers did not become reachable",
  );

  await browser("open", `${webUrl}/accounts/personal/mailboxes/INBOX`);
  await browser("set", "viewport", "1280", "900");
  await browser("find", "label", "Username", "fill", "reader");
  await browser("find", "label", "Password", "fill", "secret");
  await browser("find", "role", "button", "click", "--name", "Log in");
  await browser("wait", "500");
  assert(
    await bodyIncludes("reader@example.com"),
    "Login did not show the configured Mail account",
  );
  assert(
    !(await bodyIncludes("Choose a Mail account")),
    "Login showed a separate Account selection",
  );
  await assertPage(
    `Array.from(document.querySelectorAll(
      'aside, section[aria-label="Message list"], article[aria-label="Message content"]'
    )).length === 3`,
    "Login did not show the Reader shell",
  );
  await assertPage(
    `document.querySelector('aside button[aria-label="Expand account"]') &&
      !Array.from(document.querySelectorAll("aside button")).some(
        (button) => button.textContent.trim() === "Inbox"
      )`,
    "Configured Mail account was not collapsed before Account open",
  );
  assert((await gmailCalls()).length === 0, "Login or restored route accessed Gmail");

  await browser(
    "eval",
    `const openAccount = document.querySelector('button[aria-label="Open account personal"]');
    openAccount.click();
    openAccount.click();`,
  );
  await browser("wait", "300");
  assert(await bodyIncludes("Mail account unavailable"), "Account open failure was not visible");
  await assertCalls(["open"], "failed Account open");

  await browser(
    "eval",
    `const retryAccount = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Manual retry"
    );
    retryAccount.click();
    retryAccount.click();`,
  );
  await browser("wait", "500");
  assert(await bodyIncludes("Quiescent UI smoke"), "Account open retry did not reach Inbox");
  await assertPage(
    `document.querySelector('aside button[aria-label="Collapse account"]')`,
    "Successful Account open did not expand the account",
  );
  await assertCalls(["open", "open"], "Account open retry");
  await assertPage(
    `(() => {
      const panes = Array.from(document.querySelectorAll(
        'aside, section[aria-label="Message list"], article[aria-label="Message content"]'
      ));
      return panes.length === 3 && panes.every(
        (pane) => getComputedStyle(pane).display === 'block' && pane.getBoundingClientRect().width > 0
      );
    })()`,
    "Desktop did not render three visible reader panes",
  );

  await browser(
    "eval",
    `Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true
    });
    window.dispatchEvent(new Event("focus"));`,
  );
  await assertPage("document.hasFocus()", "Smoke page did not enter the active reading state");
  await fetch(`${apiUrl}/api/__smoke/fail/inline`, { method: "POST" });
  await clickButton("Quiescent UI smoke");
  await waitForCalls(
    ["open", "open", "detail", "inline", "action"],
    "Message open, failed inline message resource, and delayed mark-read",
  );
  await browser(
    "eval",
    `delete document.hasFocus;
    window.dispatchEvent(new Event("blur"));`,
  );
  assert(await bodyIncludes("Archive"), "Message detail did not render");
  for (const action of ["Mark", "Archive", "Delete", "Star"]) {
    assert(await bodyIncludes(action), `Message detail missing ${action} action`);
  }
  assert(
    await bodyIncludes("Inline message resource unavailable"),
    "Inline message resource failure was not visible",
  );
  const beforePassiveInlineEvents = await gmailCalls();
  await browser(
    "eval",
    `Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));`,
  );
  await browser("wait", "300");
  assert(
    await bodyIncludes("Inline message resource unavailable"),
    "Passive page lifecycle events cleared the inline message resource failure",
  );
  await assertCalls(beforePassiveInlineEvents, "inline failure page lifecycle events");
  await clickButton("Manual retry");
  await browser("wait", "500");
  await assertCalls(
    ["open", "open", "detail", "inline", "action", "inline"],
    "Inline message resource Manual retry",
  );
  await assertPage(
    `document.querySelector('iframe[title="Message body"]').srcdoc.includes("data:image/png;base64")`,
    "Retried authenticated inline message resource was not rendered from browser memory",
  );
  assert(
    (await smokeState()).trackingCalls === 0,
    "Default Message rendering loaded remote images",
  );
  await clickButton("Show images");
  await browser("wait", "500");
  assert((await smokeState()).trackingCalls > 0, "Remote image opt-in did not load remote images");
  await assertCalls(
    ["open", "open", "detail", "inline", "action", "inline"],
    "Remote image opt-in iframe reload",
  );

  await fetch(`${apiUrl}/api/__smoke/fail/search`, { method: "POST" });
  await browser("find", "placeholder", "Search this account", "fill", "invoice");
  await clickButton("Search");
  await browser("wait", "300");
  assert(await bodyIncludes("Messages unavailable"), "Search failure was not visible");
  await assertCalls(
    ["open", "open", "detail", "inline", "action", "inline", "search"],
    "failed explicit Search",
  );
  await clickButton("Manual retry");
  await browser("wait", "300");
  assert(await bodyIncludes('Search results for "invoice"'), "Search retry did not recover");
  await assertCalls(
    ["open", "open", "detail", "inline", "action", "inline", "search", "search"],
    "Search retry",
  );

  await browser(
    "eval",
    `document.querySelector('button[aria-label="Open mailbox INBOX for account personal"]').click()`,
  );
  await browser("wait", "100");
  await browser("set", "viewport", "390", "844");
  await assertPage(
    `innerWidth === 390 &&
      getComputedStyle(document.querySelector('section[aria-label="Message list"]')).display === 'block' &&
      getComputedStyle(document.querySelector('aside')).display === 'none' &&
      document.documentElement.scrollWidth === innerWidth &&
      document.querySelector('button[aria-label="Refresh current mailbox"]') &&
      getComputedStyle(document.querySelector('.reader-search-input [data-slot="leading"]')).display === 'none'`,
    "Mobile reader did not start in the Message list pane",
  );
  await clickButton("Account mailbox tree");
  await assertPage(
    `getComputedStyle(document.querySelector('aside')).display === 'block' &&
      document.querySelector('aside button[aria-label="Collapse account"]').getBoundingClientRect().height === 40 &&
      document.querySelector('aside button[aria-label="Open mailbox INBOX for account personal"]').getBoundingClientRect().height === 40`,
    "Mobile reader did not expose Account mailbox navigation",
  );
  await browser("set", "viewport", "1280", "900");
  await assertPage(
    `document.querySelector('button[aria-label="Refresh current mailbox"]').offsetParent === null &&
      document.querySelector('aside button[aria-label="Collapse account"]').getBoundingClientRect().height === 20`,
    "Mobile-only Reader controls changed the desktop layout",
  );

  const beforePassiveEvents = await gmailCalls();
  await browser(
    "eval",
    "window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online'));",
  );
  await browser("wait", "1500");
  await assertCalls(beforePassiveEvents, "idle, focus, and reconnect events");

  await browser("open", `${webUrl}/accounts/personal/search?q=invoice`);
  await browser("wait", "500");
  assert(
    await bodyIncludes("reader@example.com"),
    "Authenticated reload hid the configured account",
  );
  assert(
    !(await bodyIncludes("Choose a Mail account")),
    "Authenticated reload showed a separate Account selection",
  );
  await assertCalls(beforePassiveEvents, "authenticated full reload");

  await fetch(`${apiUrl}/api/__smoke/delay/open/personal`, { method: "POST" });
  await clickButton("Open account personal");
  await browser("wait", "100");
  await assertPage(
    `document.querySelector('button[aria-label="Open account personal"]').textContent.includes("Opening") &&
      !document.querySelector('button[aria-label="Open account work"]').disabled`,
    "Opening one Mail account disabled an independent account",
  );
  await clickButton("Open account work");
  await waitForCalls(
    [...beforePassiveEvents, "open", "open"],
    "parallel Account open for independent accounts",
  );
  await browser("wait", "5500");
  await assertPage(
    `location.pathname === "/accounts/work/mailboxes/INBOX" &&
      document.querySelectorAll('aside button[aria-label="Collapse account"]').length === 2`,
    "Parallel Account open did not preserve the latest selected account and expand both accounts",
  );

  await browser(
    "eval",
    `document.querySelector('button[aria-label="Open Inbox for account work"]').dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2 })
    );`,
  );
  await browser("wait", "100");
  assert(!(await bodyIncludes("Refresh")), "Account context menu still exposed Refresh");
  await browser("press", "Escape");

  await fetch(`${apiUrl}/api/__smoke/delay/refresh`, { method: "POST" });
  await browser(
    "eval",
    `document.querySelector('button[aria-label="Open mailbox INBOX for account work"]').dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2 })
    );`,
  );
  await browser("wait", "100");
  assert(await bodyIncludes("Refresh"), "Inbox context menu did not expose Refresh");
  await clickButton("Refresh");
  await browser("wait", "100");
  assert(await bodyIncludes("Refreshing..."), "Inbox did not show Manual refresh progress");
  await waitForCalls(
    [...beforePassiveEvents, "open", "open", "refresh"],
    "Inbox context-menu Manual refresh",
  );
  await browser("wait", "5500");

  await fetch(`${apiUrl}/api/__smoke/fail/refresh`, { method: "POST" });
  await browser(
    "eval",
    `document.querySelector('button[aria-label="Open mailbox INBOX for account personal"]').dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, button: 2 })
    );`,
  );
  await browser("wait", "100");
  await clickButton("Refresh");
  await browser("wait", "300");
  assert(await bodyIncludes("Refresh failed."), "Mailbox refresh failure lacked row feedback");
  await assertCalls(
    [...beforePassiveEvents, "open", "open", "refresh", "refresh"],
    "failed Inbox context-menu Manual refresh",
  );
  await clickButton("Manual retry");
  await browser("wait", "300");
  await assertCalls(
    [...beforePassiveEvents, "open", "open", "refresh", "refresh", "refresh"],
    "Inbox context-menu Manual retry",
  );

  await clickButton("Log out");
  await browser("wait", "300");
  assert(await bodyIncludes("Log in"), "Logout did not clear browser reader state");
  await assertCalls(
    [...beforePassiveEvents, "open", "open", "refresh", "refresh", "refresh", "closeAll"],
    "logout",
  );

  console.log("Focused Live IMAP browser smoke passed.");
} finally {
  await browser("close").catch(() => undefined);
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

function start(command, args, label) {
  const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function browser(...args) {
  return execFile(browserBin, [...browserPrefix, "--session", session, ...args]);
}

async function bodyIncludes(text) {
  const result = await browser("get", "text", "body");
  return result.stdout.includes(text);
}

async function clickButton(text) {
  const expression = `Array.from(document.querySelectorAll('button')).find((button) => [button.innerText, button.getAttribute('aria-label') ?? ''].some((label) => label.includes(${JSON.stringify(
    text,
  )})))?.click()`;
  await browser("eval", expression);
}

async function assertPage(expression, message) {
  await browser(
    "eval",
    `if (!(${expression})) { throw new Error(${JSON.stringify(message)}); } true`,
  );
}

async function gmailCalls() {
  return (await smokeState()).calls;
}

async function smokeState() {
  const response = await fetch(`${apiUrl}/api/__smoke/state`);
  return response.json();
}

async function assertCalls(expected, phase) {
  const actual = await gmailCalls();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${phase} performed unexpected Gmail work: ${JSON.stringify(actual)}`,
  );
}

async function waitForCalls(expected, phase, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let actual = [];

  while (Date.now() - startedAt < timeoutMs) {
    actual = await gmailCalls();
    const matchesExpectedPrefix = actual.every((call, index) => call === expected[index]);
    if (!matchesExpectedPrefix || actual.length > expected.length) {
      throw new Error(`${phase} performed unexpected Gmail work: ${JSON.stringify(actual)}`);
    }
    if (actual.length === expected.length) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`${phase} timed out waiting for Gmail work: ${JSON.stringify(actual)}`);
}

async function execFile(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function isReachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(predicate, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
