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
  assert(await bodyIncludes("Choose a Mail account"), "Login did not show Account selection");
  assert((await gmailCalls()).length === 0, "Login or restored route accessed Gmail");

  await browser(
    "eval",
    "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('Open Inbox'))?.click()",
  );
  await browser("wait", "300");
  assert(await bodyIncludes("Mail account unavailable"), "Account open failure was not visible");
  await assertCalls(["open"], "failed Account open");

  await clickButton("Manual retry");
  await browser("wait", "500");
  assert(await bodyIncludes("Quiescent UI smoke"), "Account open retry did not reach Inbox");
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

  await fetch(`${apiUrl}/api/__smoke/fail/inline`, { method: "POST" });
  await clickButton("Quiescent UI smoke");
  await browser("wait", "1500");
  assert(await bodyIncludes("Archive"), "Message detail did not render");
  for (const action of ["Mark", "Archive", "Delete", "Star"]) {
    assert(await bodyIncludes(action), `Message detail missing ${action} action`);
  }
  await assertCalls(
    ["open", "open", "detail", "inline", "action"],
    "Message open, failed inline message resource, and delayed mark-read",
  );
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

  await browser("set", "viewport", "390", "844");
  await assertPage(
    `innerWidth === 390 &&
      getComputedStyle(document.querySelector('section[aria-label="Message list"]')).display === 'block' &&
      getComputedStyle(document.querySelector('aside')).display === 'none'`,
    "Mobile reader did not start in the Message list pane",
  );
  await clickButton("Account mailbox tree");
  await assertPage(
    `getComputedStyle(document.querySelector('aside')).display === 'block'`,
    "Mobile reader did not expose Account mailbox navigation",
  );
  await browser("set", "viewport", "1280", "900");

  const beforePassiveEvents = await gmailCalls();
  await browser(
    "eval",
    "window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online'));",
  );
  await browser("wait", "1500");
  await assertCalls(beforePassiveEvents, "idle, focus, and reconnect events");

  await browser("open", `${webUrl}/accounts/personal/search?q=invoice`);
  await browser("wait", "500");
  assert(await bodyIncludes("Choose a Mail account"), "Authenticated reload restored reader route");
  await assertCalls(beforePassiveEvents, "authenticated full reload");

  await clickButton("Log out");
  await browser("wait", "300");
  assert(await bodyIncludes("Log in"), "Logout did not clear browser reader state");
  await assertCalls([...beforePassiveEvents, "closeAll"], "logout");

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
