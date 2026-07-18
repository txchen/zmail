import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const image = process.env.ZMAIL_SMOKE_IMAGE ?? "zmail:stateless-smoke";
const skipBuild = process.env.ZMAIL_SMOKE_SKIP_BUILD === "1";
const container = `zmail-stateless-smoke-${process.pid}`;
const directory = await mkdtemp(join(tmpdir(), "zmail-container-smoke-"));
const configPath = join(directory, "zmail.toml");

try {
  await writeFile(
    configPath,
    `mail_accounts = [
  { id = "personal", email_address = "reader@example.com", app_password = "unused-smoke-password" },
]

[reader]
read_dwell_seconds = 3

[app_login]
username = "reader"
password = "secret"
session_secret = "stateless-container-smoke-secret"
`,
    { mode: 0o600 },
  );

  if (!skipBuild) {
    await run("docker", ["build", "--tag", image, "."]);
  }

  const imageVolumes = JSON.parse(
    (await run("docker", ["image", "inspect", image, "--format", "{{json .Config.Volumes}}"]))
      .stdout,
  );
  assert(
    imageVolumes === null,
    `Image unexpectedly declares volumes: ${JSON.stringify(imageVolumes)}`,
  );

  await run("docker", [
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    "127.0.0.1::3001",
    "--mount",
    `type=bind,source=${configPath},destination=/config/zmail.toml,readonly`,
    image,
  ]);

  const mounts = JSON.parse(
    (await run("docker", ["inspect", container, "--format", "{{json .Mounts}}"])).stdout,
  );
  assert(
    mounts.length === 1 && mounts[0].Destination === "/config/zmail.toml" && mounts[0].RW === false,
    `Container mounts are not config-only and read-only: ${JSON.stringify(mounts)}`,
  );

  const binding = (await run("docker", ["port", container, "3001/tcp"])).stdout.trim();
  const port = binding.slice(binding.lastIndexOf(":") + 1);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);

  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "reader", password: "secret" }),
  });
  assert(loginResponse.status === 204, `App login returned ${loginResponse.status}`);
  const cookie = loginResponse.headers.get("set-cookie");
  assert(cookie?.includes("zmail_session="), "App login did not issue an App session");

  const accountsResponse = await fetch(`${baseUrl}/api/mail-accounts`, {
    headers: { cookie },
  });
  const accounts = await accountsResponse.json();
  assert(
    accountsResponse.status === 200 &&
      accounts.mailAccounts?.length === 1 &&
      accounts.mailAccounts[0].id === "personal",
    `Configured Mail accounts returned an unexpected response: ${JSON.stringify(accounts)}`,
  );

  const shellResponse = await fetch(baseUrl);
  assert(
    shellResponse.ok && (await shellResponse.text()).includes('<div id="app"></div>'),
    "Production web shell was not served",
  );

  console.log(
    "Stateless container smoke passed: App login and Configured Mail accounts in the Reader shell required no Gmail access or writable data volume.",
  );
} finally {
  await run("docker", ["rm", "--force", container], { allowFailure: true }).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}

async function waitForHealth(baseUrl) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        return;
      }
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Container did not become healthy within 30 seconds");
}

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (command === "docker" && args[0] === "build") {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (command === "docker" && args[0] === "build") {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`));
      }
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
