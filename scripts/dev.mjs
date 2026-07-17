import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;
const serverEntry = path.join(rootDir, "server.mjs");
const viteEntry = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const apiUrl = "http://127.0.0.1:8787/api/health";
const viteArgs = process.argv.slice(2);

let apiProcess;
let viteProcess;
let shuttingDown = false;

async function healthCheck() {
  try {
    const response = await fetch(apiUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForApi(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await healthCheck()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (viteProcess && !viteProcess.killed) viteProcess.kill();
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
  process.exit(code);
}

async function main() {
  if (!(await healthCheck())) {
    apiProcess = spawn(node, [serverEntry], {
      cwd: rootDir,
      env: { ...process.env, PORT: "8787" },
      stdio: "inherit",
    });

    apiProcess.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`MarketOS backend stopped with exit code ${code ?? 0}.`);
        stopAll(code ?? 1);
      }
    });

    if (!(await waitForApi())) {
      console.error("MarketOS backend did not become ready on http://127.0.0.1:8787.");
      stopAll(1);
    }
  } else {
    console.log("MarketOS backend is already running on http://127.0.0.1:8787.");
  }

  viteProcess = spawn(node, [viteEntry, ...viteArgs], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  });

  viteProcess.on("exit", (code) => stopAll(code ?? 0));
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

main().catch((error) => {
  console.error(error);
  stopAll(1);
});
