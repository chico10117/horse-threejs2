/* Browser smoke test. Serve the repo root first, then:
     BASE_URL=http://localhost:8765/ node tests/smoke.mjs
   Needs `playwright` resolvable (CI installs it with --no-save). */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:8765/";
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The theme mp3 is gitignored, so its 404 is expected outside a local checkout.
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });

  await page.goto(BASE_URL, { waitUntil: "load" });
  const ready = await page
    .waitForFunction(() => document.body.classList.contains("is-ready"), null, { timeout: 15000 })
    .then(() => true, () => false);
  check(ready, `${width}px: page boots (body.is-ready)`);
  check(errors.length === 0, `${width}px: no console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, `${width}px: no horizontal overflow`);
  await page.close();
}

/* Space must jump, not re-press the Gallop button that was just clicked. */
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => document.body.classList.contains("is-ready"), null, { timeout: 15000 });
await page.click("#gallopButton");
await page.waitForTimeout(1500);
await page.keyboard.press("Space");
const sawJump = await page
  .waitForFunction(() => document.getElementById("gaitValue").textContent === "jump", null, { timeout: 2000 })
  .then(() => true, () => false);
check(sawJump, "Space after clicking Gallop jumps");
check((await page.getAttribute("#gallopButton", "aria-pressed")) === "true", "Gallop stays on after Space");

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
