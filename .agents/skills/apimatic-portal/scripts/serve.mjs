#!/usr/bin/env node
/**
 * APIMatic portal preview server manager (APIMatic CLI v2).
 *
 * Usage (run from any directory — the project root is passed via --input, and
 * defaults to the current directory):
 *   node serve.mjs start   [--port 23513] [--input ./]
 *   node serve.mjs restart [--port 23513] [--input ./]
 *   node serve.mjs status  [--input ./]
 *   node serve.mjs watch   [--input ./]
 *   node serve.mjs stop    [--input ./]
 *
 * Each project keeps its own server state (PID, log, URL, heartbeat) in a folder of
 * the system temp directory named after a hash of the project's resolved path, so
 * every command acts only on the preview of the project it is given.
 *
 * `start` runs `apimatic portal serve` in the background with its output written
 * straight to a log file, so the server keeps logging after this script exits.
 * The script streams the log live and exits once the CLI prints
 * "The portal is running at <url>", or if the server dies first.
 *
 * `watch` is run after an edit. It reads what the server logs next and exits
 * 0 when the edit was accepted, 2 when the CLI rejected it or asked for a
 * restart, and 1 when no server is running.
 *
 * The CLI picks another free port on its own when the requested one is taken.
 * Auto-stop: a watchdog process stops the server after 30 min of agent inactivity.
 *
 * No external dependencies — Node.js built-ins only.
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WATCHDOG_SCRIPT = path.join(SCRIPT_DIR, "watchdog.mjs");
const STATE_ROOT = path.join(os.tmpdir(), "apimatic-portal-preview");

const IS_WINDOWS = process.platform === "win32";
const DEFAULT_PORT = 23513;
const READY_MARKER = "The portal is running at";
// The first start of a project fetches the generated SDKs and code samples and
// pre-bundles the site, which can take several minutes.
const STARTUP_TIMEOUT_MS = 300_000;
const POLL_MS = 250;

// What the CLI logs after an edit while the preview is running.
const WATCH_WINDOW_MS = 8_000;
const ACCEPTED_MARKERS = ["Applied the changes to", "a build would accept it again"];
const PROBLEM_MARKERS = [
  "keeps showing what it last accepted",
  "needs the preview restarted",
  "Restart the preview",
  "could not be applied",
  "could not be checked",
  "cannot be watched",
  "is no longer watched",
  "stopped unexpectedly",
];

// ── per-project state ──────────────────────────────────────────────────────

/** The state files kept in one project's state folder. */
function stateIn(dir) {
  return {
    dir,
    pidFile: path.join(dir, "serve.pid"),
    logFile: path.join(dir, "serve.log"),
    urlFile: path.join(dir, "serve.url"),
    heartbeatFile: path.join(dir, "serve.heartbeat"),
    inputFile: path.join(dir, "serve.input"),
  };
}

function projectState(inputPath) {
  const project = path.resolve(inputPath);
  // Windows paths ignore case, so two spellings of one path are the same project.
  const key = crypto
    .createHash("sha256")
    .update(IS_WINDOWS ? project.toLowerCase() : project)
    .digest("hex")
    .slice(0, 16);
  return { ...stateIn(path.join(STATE_ROOT, key)), project };
}

// ── helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidLines(state) {
  if (!fs.existsSync(state.pidFile)) return [];
  try {
    return fs
      .readFileSync(state.pidFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => parseInt(line, 10));
  } catch {
    return [];
  }
}

function readPid(state) {
  const pid = readPidLines(state)[0];
  return Number.isInteger(pid) ? pid : null;
}

function readWatchdogPid(state) {
  const pid = readPidLines(state)[1];
  return Number.isInteger(pid) ? pid : null;
}

function readUrl(state) {
  try {
    return fs.readFileSync(state.urlFile, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Silent best-effort — write errors should never abort a command. */
function touchHeartbeat(state) {
  try { fs.writeFileSync(state.heartbeatFile, String(Date.now())); } catch { /* best effort */ }
}

/** Safe unlink — ignores missing file or permission errors. */
function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* best effort */ }
}

function cleanUp(state) {
  safeUnlink(state.pidFile);
  safeUnlink(state.urlFile);
  safeUnlink(state.heartbeatFile);
}

/** Running previews of other projects, so one is never mistaken for this project's. */
function otherPreviews(state) {
  let entries;
  try {
    entries = fs.readdirSync(STATE_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const others = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const other = stateIn(path.join(STATE_ROOT, entry.name));
    if (other.dir === state.dir) continue;
    const pid = readPid(other);
    if (!pid || !isRunning(pid)) continue;
    let project = null;
    try { project = fs.readFileSync(other.inputFile, "utf8").trim() || null; } catch { /* unknown */ }
    others.push({ pid, project, url: readUrl(other) });
  }
  return others;
}

function printOtherPreviews(state) {
  for (const { pid, project, url } of otherPreviews(state)) {
    console.log(
      `\nNote: a preview of a different project${project ? ` (${project})` : ""} is also running` +
        ` (PID ${pid})${url ? ` at ${url}` : ""}. It is not the preview of ${state.project}.`
    );
    if (project) console.log(`To stop it: node serve.mjs stop --input "${project}"`);
  }
}

/** Strips ANSI colour codes, OSC 8 hyperlinks, spinner redraws, and blank lines. */
function clean(text) {
  const stripped = text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // A spinner redraws its line with cursor moves; treat each frame as a line so repeats collapse.
    .replace(/(?:\x1b\[[0-9]*[DGJK])+/g, "\n")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r/g, "\n");
  const lines = [];
  for (const line of stripped.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.trim() && trimmed !== lines[lines.length - 1]) lines.push(trimmed);
  }
  return lines.join("\n");
}

/** Reads what was appended to the log since `offset`. */
function readLogFrom(state, offset) {
  try {
    const size = fs.statSync(state.logFile).size;
    if (size <= offset) return { text: "", offset: size };
    const fd = fs.openSync(state.logFile, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    return { text: buf.toString(), offset: size };
  } catch {
    return { text: "", offset };
  }
}

function logSize(state) {
  try {
    return fs.statSync(state.logFile).size;
  } catch {
    return 0;
  }
}

function printLogTail(state, n = 15) {
  if (!fs.existsSync(state.logFile)) {
    console.log("(no log output yet)");
    return;
  }
  try {
    const lines = clean(fs.readFileSync(state.logFile, "utf8")).split("\n");
    console.log(lines.slice(-n).join("\n"));
  } catch {
    console.log("(log could not be read)");
  }
}

/**
 * How to launch the CLI. On Windows npm installs `apimatic` as a `.cmd` shim, and a
 * detached `cmd.exe` drops the output of the Node process it starts, so the shim is
 * read and the CLI's JavaScript entry point is run with Node directly.
 * Returns null when the CLI cannot be found.
 */
function resolveCli() {
  if (!IS_WINDOWS) return { command: "apimatic", args: [] };
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const shim = path.join(dir.replace(/^"|"$/g, ""), "apimatic.cmd");
    let contents;
    try {
      contents = fs.readFileSync(shim, "utf8");
    } catch {
      continue;
    }
    const match = contents.match(/%dp0%\\([^"]+\.js)"/i);
    if (match) {
      const entry = path.join(path.dirname(shim), match[1]);
      if (fs.existsSync(entry)) return { command: process.execPath, args: [entry] };
    }
  }
  return null;
}

function printCliNotFound() {
  console.error("ERROR: 'apimatic' command not found.");
  console.error("The APIMatic CLI is not installed or not on your PATH.");
  console.error("Fix: npm install -g @apimatic/cli@beta");
  console.error("Then verify: apimatic --version");
  console.error('Manual fallback: once installed, run "apimatic portal serve" in the project root.');
}

/** Kills the server's whole process tree: the CLI starts the site builder as a child. */
function killTree(pid, force) {
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore" });
    return;
  }
  try { process.kill(-pid, force ? "SIGKILL" : "SIGTERM"); } catch { /* already dead */ }
}

// ── commands ───────────────────────────────────────────────────────────────

async function start(state, port, inputPath) {
  const pid = readPid(state);
  if (pid && isRunning(pid)) {
    touchHeartbeat(state);
    const url = readUrl(state);
    console.log(`Already running for ${state.project} (PID ${pid}).${url ? ` Server URL: ${url}` : ""}`);
    console.log("Use 'node serve.mjs status' to check logs, 'restart' to restart, or 'stop' to stop.");
    printOtherPreviews(state);
    return 0;
  }
  cleanUp(state);

  if (!fs.existsSync(inputPath)) {
    console.error(`ERROR: Input path not found: "${inputPath}"`);
    console.error("Make sure you are running from the project root (the directory that contains src/).");
    console.error("Example: node serve.mjs start --input ./");
    console.error('Manual fallback: cd into your project root and run "apimatic portal serve".');
    return 1;
  }

  const cli = resolveCli();
  if (!cli) {
    printCliNotFound();
    return 1;
  }

  // The server writes straight to the log file, so it keeps logging after this script exits.
  let logFd;
  try {
    fs.mkdirSync(state.dir, { recursive: true });
    fs.writeFileSync(state.inputFile, state.project);
    logFd = fs.openSync(state.logFile, "w");
  } catch (err) {
    console.error(`ERROR: Cannot write to the preview state directory: ${err.message}`);
    console.error(`Path: ${state.dir}`);
    console.error("Fix: check that you have write permission to the system temp directory.");
    console.error('Manual fallback: run "apimatic portal serve" yourself in the project root.');
    return 1;
  }

  const child = spawn(cli.command, [...cli.args, "portal", "serve", `--port=${port}`, `--input=${inputPath}`], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  fs.closeSync(logFd);

  let spawnError = null;
  let exitCode = null;
  child.on("error", (err) => { spawnError = err; });
  child.on("exit", (code) => { exitCode = code ?? 1; });

  // Give a missing executable the chance to surface before anything is written.
  await sleep(POLL_MS);
  if (spawnError) {
    cleanUp(state);
    if (spawnError.code === "ENOENT") {
      printCliNotFound();
    } else {
      console.error(`ERROR: Failed to start server process: ${spawnError.message}`);
      console.error('Manual fallback: run "apimatic portal serve" yourself in the project root.');
    }
    return 1;
  }

  try {
    fs.writeFileSync(state.pidFile, String(child.pid));
  } catch (err) {
    console.error(`ERROR: Cannot write PID file: ${err.message}`);
    console.error(`Fix: check that you have write permission to ${state.dir}.`);
    console.error('Manual fallback: run "apimatic portal serve" yourself in the project root.');
    killTree(child.pid, true);
    return 1;
  }
  touchHeartbeat(state);

  console.log(`Starting APIMatic portal preview for ${state.project} (PID ${child.pid})...`);
  console.log("Streaming output from apimatic portal serve:\n");

  let offset = 0;
  let seen = "";
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const chunk = readLogFrom(state, offset);
    offset = chunk.offset;
    if (chunk.text) {
      seen += chunk.text;
      const text = clean(chunk.text);
      if (text) console.log(text);
    }

    const readyLine = clean(seen).split("\n").find((line) => line.includes(READY_MARKER));
    if (readyLine) {
      const url = (readyLine.match(/https?:\/\/[^\s'"]+/) || [])[0] || `http://localhost:${port}`;
      try { fs.writeFileSync(state.urlFile, url); } catch { /* best effort */ }

      const watchdog = spawn(
        process.execPath,
        [WATCHDOG_SCRIPT, `--server-pid=${child.pid}`, `--heartbeat=${state.heartbeatFile}`],
        { detached: true, stdio: "ignore", windowsHide: true }
      );
      watchdog.on("error", () => {
        console.error("WARNING: The portal server is running but will NOT auto-stop after 30 minutes.");
        console.error("Remember to stop it manually: node serve.mjs stop --input <dir>");
      });
      watchdog.unref();
      try { fs.writeFileSync(state.pidFile, `${child.pid}\n${watchdog.pid}`); } catch { /* best effort */ }

      console.log(`\nPortal is ready: ${url}`);
      console.log("Live reload is active. Some edits need a restart: node serve.mjs restart --input <dir>");
      console.log("Server will auto-stop after 30 minutes of inactivity.");
      console.log("To stop: node serve.mjs stop --input <dir>");
      printOtherPreviews(state);
      console.log("");
      child.unref();
      return 0;
    }

    if (exitCode !== null || !isRunning(child.pid)) {
      const rest = clean(readLogFrom(state, offset).text);
      if (rest) console.log(rest);
      console.error(`\nServer process exited (code ${exitCode ?? "unknown"}) before becoming ready.`);
      console.error("Full output is above. Check the error and retry.");
      console.error('Manual fallback: run "apimatic portal serve" yourself in the project root.');
      cleanUp(state);
      return 1;
    }
  }

  console.log(`\nTimeout after ${STARTUP_TIMEOUT_MS / 1000}s — the portal URL has not appeared yet.`);
  console.log("The server may still be starting. Check with 'node serve.mjs status --input <dir>'.");
  child.unref();
  return 0;
}

function status(state) {
  const pid = readPid(state);
  if (pid === null) {
    console.log(`No server running for ${state.project} (no PID file).`);
  } else if (isRunning(pid)) {
    touchHeartbeat(state);
    const url = readUrl(state);
    console.log(`Running for ${state.project} (PID ${pid}).${url ? ` URL: ${url}` : " URL not detected yet."}`);
    console.log("\nRecent log output:");
    printLogTail(state, 15);
  } else {
    console.log(`Process ${pid} is no longer running. Cleaning stale PID file.`);
    cleanUp(state);
  }
  printOtherPreviews(state);
  return 0;
}

async function stop(state) {
  const pid = readPid(state);
  if (pid === null) {
    console.log(`No server running for ${state.project} (no PID file).`);
    return 0;
  }

  // Kill the watchdog first so it doesn't race to kill the server independently.
  const watchdogPid = readWatchdogPid(state);
  if (watchdogPid && isRunning(watchdogPid)) {
    try { process.kill(watchdogPid); } catch { /* already dead */ }
  }
  // Deleting the heartbeat also tells a watchdog that missed the signal to exit.
  safeUnlink(state.heartbeatFile);

  if (!isRunning(pid)) {
    console.log(`Process ${pid} already stopped. Removing stale PID file.`);
    cleanUp(state);
    return 0;
  }

  killTree(pid, false);
  for (let waited = 0; waited < 3000 && isRunning(pid); waited += 200) await sleep(200);
  if (isRunning(pid)) {
    killTree(pid, true);
    await sleep(500);
  }

  if (isRunning(pid)) {
    console.error(`ERROR: Could not stop process ${pid}.`);
    console.error("The server may have been started by a different user.");
    console.error(IS_WINDOWS ? `Manual fix: taskkill /PID ${pid} /T /F` : `Manual fix: kill -9 -${pid}`);
    return 1;
  }
  cleanUp(state);
  console.log(`Stopped the preview of ${state.project} (PID ${pid}).`);
  return 0;
}

async function watch(state) {
  const pid = readPid(state);
  if (!pid || !isRunning(pid)) {
    console.log(`No server running for ${state.project} — nothing to watch.`);
    return 1;
  }

  let offset = logSize(state);
  let seen = "";
  console.log("Watching the preview for the result of the edit...\n");

  const deadline = Date.now() + WATCH_WINDOW_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    touchHeartbeat(state);
    const chunk = readLogFrom(state, offset);
    offset = chunk.offset;
    if (!chunk.text) continue;
    seen += chunk.text;
    const text = clean(chunk.text);
    if (text) console.log(text);

    // Wait for the rest of a multi-line report before judging it.
    await sleep(500);
    const tail = readLogFrom(state, offset);
    offset = tail.offset;
    if (tail.text) {
      seen += tail.text;
      const more = clean(tail.text);
      if (more) console.log(more);
    }

    const all = clean(seen);
    if (PROBLEM_MARKERS.some((marker) => all.includes(marker))) {
      console.log("\nThe preview did not apply the edit. See the explanation above.");
      return 2;
    }
    if (ACCEPTED_MARKERS.some((marker) => all.includes(marker))) {
      console.log("\nThe preview applied the edit. Refresh the browser if it hasn't updated.");
      return 0;
    }
  }

  if (!isRunning(pid)) {
    console.log("The portal server stopped. Start it again with 'node serve.mjs start --input <dir>'.");
    return 1;
  }
  // Valid page and nav.json edits reload the browser without logging anything.
  console.log("No problems reported. The preview has picked up the edit — refresh the browser if it hasn't updated.");
  return 0;
}

// ── CLI entry point ────────────────────────────────────────────────────────

function parseArgs(args) {
  const result = { port: DEFAULT_PORT, input: "./" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--port=")) result.port = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--input=")) result.input = arg.slice("--input=".length);
    else if (arg === "--port" && args[i + 1]) result.port = parseInt(args[++i], 10);
    else if (arg === "--input" && args[i + 1]) result.input = args[++i];
  }
  return result;
}

const [, , command, ...rest] = process.argv;
const { port, input } = parseArgs(rest);
const state = projectState(input);
let exitCode;

switch (command) {
  case "start":
    exitCode = await start(state, port, input);
    break;
  case "restart":
    exitCode = await stop(state);
    if (exitCode === 0) exitCode = await start(state, port, input);
    break;
  case "status":
    exitCode = status(state);
    break;
  case "stop":
    exitCode = await stop(state);
    break;
  case "watch":
    exitCode = await watch(state);
    break;
  default:
    console.log("Usage: node serve.mjs <start|restart|status|watch|stop> [--port 23513] [--input ./]");
    console.log("       --input is the project root (the directory containing src/); it defaults to ./");
    console.log("       Server auto-stops after 30 minutes of agent inactivity.");
    exitCode = 1;
}

process.exit(exitCode);
