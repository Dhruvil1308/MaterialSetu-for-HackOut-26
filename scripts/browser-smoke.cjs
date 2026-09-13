/** Browser integration smoke: temporary database, no production services. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "materialsetu-qa-"));
const shots = process.env.SMOKE_SHOTS || path.join(os.tmpdir(), "materialsetu-smoke-shots");
fs.mkdirSync(shots, { recursive: true });
const children = [];
const API_PORT = process.env.API_PORT || "8000";
const API = `http://localhost:${API_PORT}`;
function start(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.log = "";
  child.stdout.on("data", (d) => (child.log += d));
  child.stderr.on("data", (d) => (child.log += d));
  children.push(child);
  return child;
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    "Server did not start: " +
      url +
      "\n" +
      children.map((p) => p.log).join("\n"),
  );
}
(async () => {
  let browser;
  try {
    start(
      process.env.PYTHON || "python3",
      ["-m", "uvicorn", "main:app", "--port", API_PORT],
      path.join(root, "services/api"),
      {
        DEMO_MODE: "1",
        DATABASE_URL: "sqlite:///" + path.join(tmp, "demo.db"),
        UPLOAD_DIR: path.join(tmp, "uploads"),
      },
    );
    start(
      process.execPath,
      [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
      path.join(root, "apps/web"),
    );
    await Promise.all([
      ready(`${API}/api/health`),
      ready("http://localhost:5173"),
    ]);
    let launch = { headless: true };
    // Optional executable override for CI/container environments.
    if (process.env.CHROMIUM_EXECUTABLE)
      launch = {
        ...launch,
        executablePath: process.env.CHROMIUM_EXECUTABLE,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      };
    browser = await chromium.launch(launch);
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:5173");
    await expect(page.locator(".listing-card").first()).toBeVisible();
    await page.locator(".demo-bar select").selectOption("buyer");
    await expect(page.locator(".workspace b")).toHaveText(
      "Setu Packaging Studio",
    );
    await page
      .getByLabel("Describe material demand")
      .fill("50 kg PET within 30 km");
    await page.locator(".search-line button").click();
    await expect(page.locator(".listing-card")).toHaveCount(3);
    await expect(page.locator(".pool-card").first()).toContainText("PET");
    await page.screenshot({
      path: path.join(shots, "web-marketplace.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Request this supply" })
      .first()
      .click();
    await page
      .getByLabel("Proposed pickup arrangements")
      .fill("Demo collection Friday at 10 am");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Every exchange, in one place." }),
    ).toBeVisible();
    await expect(
      page.locator(".exchange").filter({ hasText: "Demo collection Friday" }),
    ).toContainText("pending");
    const buyerToken = await page.evaluate(() =>
      localStorage.getItem("materialsetu-token"),
    );
    const orders = await (
      await fetch(`${API}/api/exchanges`, {
        headers: { Authorization: "Bearer " + buyerToken },
      })
    ).json();
    const order = orders.find((e) =>
      e.pickup.includes("Demo collection Friday"),
    );
    if (order.items.length < 2)
      throw new Error("Expected a multi-supplier PET plan.");
    for (const item of order.items) {
      await page.locator(".demo-bar select").selectOption(item.seller_id);
      await expect(page.locator(".workspace b")).toHaveText(item.seller_name);
      const card = page
        .locator(".exchange")
        .filter({ hasText: "Demo collection Friday" });
      await card
        .getByRole("button", { name: "Accept & reserve", exact: true })
        .click();
      await expect(card).toContainText("accepted");
    }
    await page.locator(".demo-bar select").selectOption("buyer");
    await expect(page.locator(".workspace b")).toHaveText(
      "Setu Packaging Studio",
    );
    const card = page
      .locator(".exchange")
      .filter({ hasText: "Demo collection Friday" });
    await expect(card).toContainText("All suppliers accepted");
    await page.screenshot({
      path: path.join(shots, "web-exchange.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Find materials", exact: true })
      .first()
      .click();
    await page.locator(".listing-card").first().click();
    await expect(page.getByRole("dialog")).toContainText("GST review");
    await page.screenshot({
      path: path.join(shots, "web-trust.png"),
      fullPage: true,
    });
    await page.getByLabel("Close dialog").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(shots, "web-phone.png"),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (overflow) throw new Error("Website overflows narrow viewport.");
    if (fs.existsSync(path.join(root, "apps/mobile/dist/index.html"))) {
      start(
        process.env.PYTHON || "python3",
        ["-m", "http.server", "8081", "--bind", "127.0.0.1"],
        path.join(root, "apps/mobile/dist"),
      );
      await ready("http://localhost:8081");
      const mobile = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      mobile.on("pageerror", (e) => errors.push("Mobile web: " + e.message));
      await mobile.goto("http://localhost:8081");
      await expect(
        mobile.getByText("PET", { exact: true }).first(),
      ).toBeVisible();
      await mobile.screenshot({
        path: path.join(shots, "native-web-discover.png"),
        fullPage: true,
      });
      await mobile.getByRole("tab", { name: /Pools/ }).click();
      await expect(
        mobile.getByText("Request this supply →").first(),
      ).toBeVisible();
      await mobile.screenshot({
        path: path.join(shots, "native-web-pools.png"),
        fullPage: true,
      });
      await mobile.getByRole("tab", { name: /Account/ }).click();
      await mobile.getByText("Sign in or register", { exact: true }).click();
      await expect(
        mobile.getByText("Welcome back.", { exact: true }),
      ).toBeVisible();
    }
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "PASS: desktop search, local pool request, supplier acceptance, trust dialog, responsive layout; mobile web discovery, pooling and login. No browser runtime errors.",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    for (const child of children) child.kill("SIGTERM");
  }
})();
