#!/usr/bin/env node
/**
 * APIMatic portal server watchdog.
 *
 * Spawned by serve.mjs start. Runs detached in the background.
 * Kills the portal server if the heartbeat file has not been touched
 * in IDLE_TIMEOUT_MS (default: 30 minutes).
 *
 * Usage:
 *   node watchdog.mjs --server-pid=<pid> --heartbeat=<path>
 *
 * No external dependencies — Node.js built-ins only.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const POLL_MS = 60_000; // check every 60 seconds

// ── parse args ─────────────────────────────────────────────────────────────

function parseArgs() {
  const result = { serverPid: null, heartbeat: null };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--server-pid=")) result.serverPid = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--heartbeat=")) result.heartbeat = arg.slice("--heartbeat=".length);
  }
  return result;
}

const { serverPid, heartbeat } = parseArgs();

if (!serverPid || isNaN(serverPid) || !heartbeat) {
  process.stderr.write("watchdog: missing --server-pid or --heartbeat\n");
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Kill the whole process tree (same pattern as serve.mjs stop): on Windows the
// server PID is the shell that runs the CLI, and the CLI starts its own children.
function killTree(force) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(serverPid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-serverPid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // already dead
  }
}

function killServer() {
  killTree(false);
  // Force-kill after 3 s if still running
  setTimeout(() => {
    if (isRunning(serverPid)) killTree(true);
    process.exit(0);
  }, 3000);
}

// ── main loop ──────────────────────────────────────────────────────────────

setInterval(() => {
  // If the server is no longer running, our job is done
  if (!isRunning(serverPid)) {
    process.exit(0);
  }

  // If the heartbeat file is gone, the agent or stop command cleaned up — exit
  if (!fs.existsSync(heartbeat)) {
    process.exit(0);
  }

  // Check how long ago the heartbeat was last touched
  try {
    const stat = fs.statSync(heartbeat);
    const idleMs = Date.now() - stat.mtimeMs;
    if (idleMs > IDLE_TIMEOUT_MS) {
      // Agent has been gone for 30+ minutes — stop the server
      killServer();
    }
  } catch {
    // Can't stat heartbeat — treat as gone
    process.exit(0);
  }
}, POLL_MS);
