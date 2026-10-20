/**
 * Records the Devpost video's scene takes on the React back-office.
 *
 *   npm run build && npm start          # the server on :8790 (sandbox rails)
 *   npx tsx scripts/record-video.ts     # takes land in docs/video/takes/
 *
 * The cookie in here is a LOCAL test session — production logins are real
 * Connect-with-PayPal, which needs a human at PayPal's consent page.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8790";
const COOKIE = process.env.CB_SESSION_COOKIE ?? "";
const OUT = path.join("docs", "video", "takes");
fs.mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1440, height: 900 } as const;

async function record(name: string, play: (page: import("playwright").Page) => Promise<void>): Promise<void> {
  const before = new Set(fs.readdirSync(OUT));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: OUT, size: VIEW } });
  if (COOKIE) {
    await context.addCookies([{ name: "cb_session", value: COOKIE, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }]);
  }
  const page = await context.newPage();
  try {
    await play(page);
    await page.waitForTimeout(1_500);
  } finally {
    await context.close(); // flushes the video file
    await browser.close();
  }
  // playwright names the file randomly: the one that appeared is this take
  const fresh = fs.readdirSync(OUT).find((f) => f.endsWith(".webm") && !before.has(f));
  const target = path.join(OUT, `${name}.webm`);
  if (fresh) fs.renameSync(path.join(OUT, fresh), target);
  console.log(`take ${name}: ${target}`);
}

const settle = (page: import("playwright").Page, ms = 2_500) => page.waitForTimeout(ms);
// the console's <label>s are not wired to their inputs: target the sibling control
const field = (page: import("playwright").Page, label: string) =>
  page.locator(`div:has(> label:text-is("${label}")) > input, div:has(> label:text-is("${label}")) > select, div:has(> label:text-is("${label}")) > textarea`).first();

async function consolePage(page: import("playwright").Page): Promise<void> {
  await page.goto(`${BASE}/`);
  await settle(page, 3_500); // balance + money view load
}

async function scene1Hook(page: import("playwright").Page): Promise<void> {
  // the refusal, big and red: attempt 45.00 under a 30.00 cap
  await consolePage(page);
  await field(page, "Amount").fill("45.00");
  await field(page, "What for").fill("USB hub");
  await page.getByRole("button", { name: "Attempt purchase" }).click();
  await settle(page, 3_000);
}

async function scene2Grant(page: import("playwright").Page): Promise<void> {
  await consolePage(page);
  await field(page, "Principal (you)").fill("Sam");
  await field(page, "Agent").fill("claude-desktop");
  await field(page, "Purpose").fill("office supplies, this week");
  await field(page, "Max / transaction").fill("30.00");
  await field(page, "Max total").fill("60.00");
  await page.getByRole("button", { name: "Grant mandate" }).click();
  await settle(page, 3_000);
}

async function scene3Autopilot(page: import("playwright").Page): Promise<void> {
  // the sealed activation: type the goal, the agent shops, the words are sealed
  await consolePage(page);
  await page.locator("textarea").first().fill("buy me two USB-C cables, max 25 dollars");
  await page.getByRole("button", { name: /Acheter maintenant/ }).click();
  await settle(page, 26_000); // the autopilot loop: catalog search, pick, purchase through the enforcer
  await page.locator("text=steps").first().scrollIntoViewIfNeeded().catch(() => undefined);
  await settle(page, 2_000);
}

async function scene4Seller(page: import("playwright").Page): Promise<void> {
  await page.goto(`${BASE}/dashboard`);
  await settle(page, 4_000);
  await page.locator(".ag-row").first().click().catch(() => undefined);
  await settle(page, 3_000);
  await page.evaluate(() => document.querySelector("[class*='drawer'], aside, .evidence")?.scrollIntoView({ block: "start" })).catch(() => undefined);
  await settle(page, 1_500);
}

async function scene5Analytics(page: import("playwright").Page): Promise<void> {
  await page.goto(`${BASE}/analytics`);
  await settle(page, 9_000); // AG Studio chunk + data engine
  await page.evaluate(() => window.scrollBy(0, 40));
  await settle(page, 1_200);
}

async function scene6Verify(page: import("playwright").Page): Promise<void> {
  await page.goto(`${BASE}/verify`);
  await settle(page, 2_500);
  // open the newest receipt from the verify page's list if present
  const link = page.locator("a", { hasText: /rcpt-/ }).first();
  if (await link.isVisible().catch(() => false)) {
    await link.click();
    await settle(page, 3_500);
  }
}

async function scene7Close(page: import("playwright").Page): Promise<void> {
  await page.goto(`${BASE}/`);
  await settle(page, 3_000);
}

const scenes: Array<[string, (page: import("playwright").Page) => Promise<void>]> = [
  ["scene1-hook-refusal", scene1Hook],
  ["scene2-grant", scene2Grant],
  ["scene3-autopilot-sealed", scene3Autopilot],
  ["scene4-seller", scene4Seller],
  ["scene5-analytics", scene5Analytics],
  ["scene6-verify", scene6Verify],
  ["scene7-close", scene7Close],
];

const only = process.env.SCENE;
for (const [name, play] of scenes) {
  if (only && !name.startsWith(only)) continue;
  await record(name, play);
}
console.log("done:", OUT);
