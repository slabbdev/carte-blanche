#!/usr/bin/env node
/**
 * APIMatic browser-based auth launcher.
 *
 * Usage:
 *   node auth-login.mjs
 *
 * Spawns `apimatic auth login` as a detached process so the terminal is not
 * blocked while the user completes the browser OAuth flow. Prints a message
 * for Claude to relay to the user, then exits immediately.
 *
 * After the user confirms sign-in in the browser, Claude should run:
 *   apimatic auth status
 * to verify the session is active.
 *
 * No external dependencies — Node.js built-ins only.
 */

import { spawn } from "node:child_process";

const child = spawn("apimatic", ["auth", "login"], {
  detached: true,
  stdio: "ignore",
  shell: process.platform === "win32",
});
child.unref();

console.log(`AUTH_LOGIN_LAUNCHED pid=${child.pid}`);
console.log(
  "A browser window has opened. Complete sign-in in the browser, then confirm here when done."
);
