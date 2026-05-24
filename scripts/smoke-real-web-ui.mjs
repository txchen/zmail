import { spawn } from "node:child_process";

const webUrl = process.env.ZMAIL_SMOKE_WEB_URL ?? "http://localhost:5173";
const apiUrl = process.env.ZMAIL_SMOKE_API_URL ?? "http://localhost:3001";
const username = process.env.ZMAIL_SMOKE_USERNAME ?? "zmail";
const password = process.env.ZMAIL_SMOKE_PASSWORD ?? "zmail";
const smokeRun = `zmail-smoke-${Date.now()}`;

let devServer;

try {
  const startedServer =
    !(await isReachable(webUrl)) || !(await isReachable(`${apiUrl}/api/health`));

  if (startedServer) {
    devServer = spawn("vp", ["run", "dev"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    devServer.stdout.on("data", (chunk) => process.stdout.write(`[dev] ${chunk}`));
    devServer.stderr.on("data", (chunk) => process.stderr.write(`[dev] ${chunk}`));

    await waitFor(
      async () => (await isReachable(webUrl)) && (await isReachable(`${apiUrl}/api/health`)),
      {
        timeoutMs: 30_000,
        message: "Zmail dev server did not become reachable",
      },
    );
  }

  await smokeDesktop();
  await smokeMobile();

  console.log("Real web UI smoke passed.");
} finally {
  if (devServer) {
    devServer.kill("SIGTERM");
  }
}

async function smokeDesktop() {
  const tab = "desktop";
  await camou([
    "open",
    "--session",
    sessionFor(tab),
    "--tabname",
    tab,
    "--headless",
    "--width",
    "1280",
    "--height",
    "900",
    webUrl,
  ]);
  await login(tab);

  const defaultView = await evalPage(tab, async () => ({
    path: `${location.pathname}${location.search}`,
    text: document.body.innerText,
    panes: Array.from(
      document.querySelectorAll(
        'aside, section[aria-label="Message list"], article[aria-label="Message content"]',
      ),
    ).map((element) => ({
      label: element.getAttribute("aria-label"),
      display: getComputedStyle(element).display,
      width: element.getBoundingClientRect().width,
    })),
  }));

  assert(
    defaultView.path.startsWith("/accounts/"),
    "App login did not route into an account reader view",
  );
  assert(defaultView.path.endsWith("/unread"), "Default reader view is not an Account unread view");
  assert(defaultView.text.includes("Unread Messages"), "Account unread view did not render");
  assert(
    defaultView.panes.length === 3 &&
      defaultView.panes.every((pane) => pane.display === "block" && pane.width > 0),
    "Desktop did not render three visible reader panes",
  );

  const accountId = defaultView.path.split("/")[2];
  await runSearch(tab);
  await runDiagnostics(tab);
  await maybeSmokeMessageDetail(tab, accountId);
}

async function smokeMobile() {
  const tab = "mobile";
  await camou([
    "open",
    "--session",
    sessionFor(tab),
    "--tabname",
    tab,
    "--headless",
    "--width",
    "390",
    "--height",
    "844",
    webUrl,
  ]);
  await login(tab);

  const mobileList = await evalPage(tab, async () => ({
    width: innerWidth,
    text: document.body.innerText,
    listDisplay: getComputedStyle(document.querySelector('section[aria-label="Message list"]'))
      .display,
    navDisplay: getComputedStyle(document.querySelector("aside")).display,
  }));

  assert(mobileList.width === 390, "Mobile smoke did not use the expected viewport width");
  assert(
    mobileList.listDisplay === "block",
    "Mobile unread route did not start in the Message list pane",
  );
  assert(
    mobileList.navDisplay === "none",
    "Mobile unread route should not show the Account mailbox tree pane",
  );
  assert(mobileList.text.includes("Search"), "Search is not accessible on mobile Message list");

  await clickByText(tab, "button", "Account mailbox tree");
  const navText = await evalPage(tab, () => document.body.innerText);
  assert(navText.includes("ACCOUNTS"), "Mobile did not navigate back to the Account mailbox tree");
}

async function login(tab) {
  await waitFor(async () => {
    const text = await evalPage(tab, () => document.body.innerText);
    return text.includes("Log in") || text.includes("ACCOUNTS");
  });

  const alreadyLoggedIn = await evalPage(tab, () => document.body.innerText.includes("ACCOUNTS"));
  if (alreadyLoggedIn) {
    return;
  }

  await evalPage(
    tab,
    ({ username, password }) => {
      const [usernameInput, passwordInput] = document.querySelectorAll("input");
      usernameInput.value = username;
      usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
      passwordInput.value = password;
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("form")?.requestSubmit();
    },
    { username, password },
  );

  await waitFor(
    async () => {
      const text = await evalPage(tab, () => document.body.innerText);
      return text.includes("ACCOUNTS") || text.includes("Unread Messages");
    },
    {
      message: async () =>
        `Login did not reach the reader UI. Current text:\n${await evalPage(tab, () => document.body.innerText)}`,
    },
  );
}

async function runSearch(tab) {
  await evalPage(tab, () => {
    const input = document.querySelector('input[placeholder="Search this account"]');
    input.value = "invoice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.innerText.trim() === "Search")
      ?.click();
  });

  await waitFor(
    async () => {
      const state = await evalPage(tab, () => ({
        path: `${location.pathname}${location.search}`,
        text: document.body.innerText,
      }));
      return (
        state.path.includes("/search?q=invoice") &&
        state.text.includes('Search results for "invoice"')
      );
    },
    { message: "Search result view did not render" },
  );

  await clickByText(tab, "button", "Clear search");
  await waitFor(
    async () => {
      const state = await evalPage(tab, () => ({
        path: `${location.pathname}${location.search}`,
        text: document.body.innerText,
      }));
      return state.path.endsWith("/unread") && state.text.includes("Unread Messages");
    },
    { message: "Clearing Search did not return to the previous reader view" },
  );
}

async function runDiagnostics(tab) {
  const beforePath = await evalPage(tab, () => `${location.pathname}${location.search}`);
  await clickByText(tab, "button", "Open diagnostics");
  await waitFor(async () =>
    (await evalPage(tab, () => document.body.innerText)).includes("Mail account diagnostics"),
  );
  await clickByText(tab, "button", "Run diagnostics");
  await waitFor(
    async () => {
      const text = await evalPage(tab, () => document.body.innerText);
      return text.includes("Diagnostics passed") || text.includes("Diagnostics failed");
    },
    { timeoutMs: 15_000, message: "Diagnostics did not complete" },
  );
  const afterPath = await evalPage(tab, () => `${location.pathname}${location.search}`);
  assert(afterPath === beforePath, "Diagnostics changed the reader route");
}

async function maybeSmokeMessageDetail(tab, accountId) {
  const messageButtonText = await evalPage(tab, () => {
    const buttons = Array.from(
      document.querySelectorAll('section[aria-label="Message list"] button'),
    );
    return buttons.find(
      (button) => !["Search", "Clear search", "Messages"].includes(button.innerText.trim()),
    )?.innerText;
  });

  if (!messageButtonText) {
    console.log("No seeded Messages found; skipping Message detail/action smoke.");
    return;
  }

  await evalPage(tab, () => {
    const buttons = Array.from(
      document.querySelectorAll('section[aria-label="Message list"] button'),
    );
    buttons
      .find((button) => !["Search", "Clear search", "Messages"].includes(button.innerText.trim()))
      ?.click();
  });
  await waitFor(async () =>
    (await evalPage(tab, () => document.body.innerText)).includes("Archive"),
  );

  const detailText = await evalPage(tab, () => document.body.innerText);
  for (const label of ["Mark", "Archive", "Delete", "Star"]) {
    assert(detailText.includes(label), `Message detail missing ${label} action`);
  }

  const messagePath = await evalPage(tab, () => location.pathname);
  assert(
    messagePath.startsWith(`/accounts/${accountId}/`),
    "Message detail route is not account scoped",
  );
}

async function clickByText(tab, selector, text) {
  await evalPage(
    tab,
    ({ selector, text }) => {
      const element = Array.from(document.querySelectorAll(selector)).find((candidate) =>
        [candidate.innerText, candidate.getAttribute("aria-label") ?? ""].some((label) =>
          label.includes(text),
        ),
      );
      if (!element) {
        throw new Error(`Missing clickable element: ${text}`);
      }
      element.click();
    },
    { selector, text },
  );
}

async function evalPage(tab, expression, arg) {
  const source =
    typeof expression === "function"
      ? `(${expression.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`
      : expression;
  const output = await camou([
    "eval",
    "--session",
    sessionFor(tab),
    "--tabname",
    tab,
    "--json",
    source,
  ]);
  return JSON.parse(output).result;
}

function sessionFor(tab) {
  return `${smokeRun}-${tab}`;
}

async function camou(args) {
  const result = await execFile("camou", args);
  return result.stdout;
}

async function execFile(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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
        return;
      }

      reject(
        new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stdout}\n${stderr}`),
      );
    });
  });
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    typeof options.message === "function"
      ? await options.message()
      : (options.message ?? "Timed out waiting for condition"),
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
