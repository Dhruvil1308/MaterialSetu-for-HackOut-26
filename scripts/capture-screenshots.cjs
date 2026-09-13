/** Captures the README screenshots from the product as it ships.
 *
 * Demo mode stays OFF, exactly as on the live site, so no demo banner and no
 * account switcher appear. It starts its own API on a throwaway SQLite database,
 * creates a handful of businesses through the public API the way real users
 * would - registration, listings, GST, photos, a pooled request, a handover, a
 * review - makes the reviewer with services/api/set_admin.py, and photographs
 * each role's panel. Nothing touches a live database.
 *
 *     cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:8137/api npx expo export --platform web
 *     node scripts/capture-screenshots.cjs
 *
 * Writes docs/screenshots/*.png. Mobile shots are skipped if apps/mobile/dist is missing.
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "materialsetu-shots-"));
const out = path.join(root, "docs/screenshots");
const PY = process.env.PYTHON || "python3";
const API = "http://localhost:8137";
const WEB = "http://localhost:5305";
const APP = "http://localhost:8081";
const db = "sqlite:///" + path.join(tmp, "shots.db");
const serverEnv = {
  DEMO_MODE: "0",
  DATABASE_URL: db,
  UPLOAD_DIR: path.join(tmp, "uploads"),
  SUPABASE_URL: "",
  SUPABASE_SERVICE_KEY: "",
  OPENAI_API_KEY: "",
  CORS_ORIGINS: `${APP},${WEB}`,
};
const kids = [];
const run = (cmd, args, cwd, env = {}) => {
  const k = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: "ignore" });
  kids.push(k);
  return k;
};
const ready = async (url) => {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("did not start: " + url);
};
async function call(method, route, token, body) {
  const res = await fetch(API + "/api" + route, {
    method,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const near = (dLat, dLon) => ({ latitude: 23.588 + dLat, longitude: 72.369 + dLon });
async function business(kind, name, email, where, city = "Mehsana") {
  const r = await call("POST", "/auth/register", null, {
    kind, name, email, city, password: "screenshot-password", ...where,
  });
  return { ...r.user, token: r.token };
}
async function upload(token, file, kind, listing_id) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), path.basename(file));
  form.append("kind", kind);
  if (listing_id) form.append("listing_id", listing_id);
  return call("POST", "/evidence", token, form);
}
async function exchange(token, body) {
  const { id } = await call("POST", "/exchanges", token, body);
  return (await call("GET", "/exchanges", token)).find((e) => e.id === id);
}
const shot = (page, name, opts = {}) =>
  page.screenshot({ path: path.join(out, name), ...opts }).then(() => console.log("  " + name));

(async () => {
  let browser;
  try {
    // Sample photographs: plain generated images, clearly not anyone's real evidence.
    execFileSync(PY, ["-c", `
from PIL import Image, ImageDraw
for name, colour in [("photo", (126, 170, 190)), ("slip", (236, 232, 220))]:
    im = Image.new("RGB", (640, 480), colour)
    d = ImageDraw.Draw(im)
    for y in range(0, 480, 24):
        d.line([(0, y), (640, y + 40)], fill=tuple(max(0, c - 30) for c in colour), width=3)
    im.save(r"${tmp}/" + name + ".jpg", quality=85)
`]);

    run(PY, ["-m", "uvicorn", "main:app", "--port", "8137"], path.join(root, "services/api"), serverEnv);
    run(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5305"],
      path.join(root, "apps/web"), { API_PORT: "8137" });
    const mobile = fs.existsSync(path.join(root, "apps/mobile/dist/index.html"));
    if (mobile) run(PY, ["-m", "http.server", "8081", "--bind", "127.0.0.1"], path.join(root, "apps/mobile/dist"));
    await Promise.all([ready(API + "/api/health"), ready(WEB), ...(mobile ? [ready(APP)] : [])]);
    if ((await call("GET", "/health")).demo) throw new Error("demo mode must be off for these screenshots");

    // --- the people -------------------------------------------------------
    console.log("creating businesses through the public API");
    const shree = await business("supplier", "Shree Polymers", "shree@example.test", near(0.012, 0.008));
    const kalol = await business("supplier", "Kalol Plastics", "kalol@example.test", near(-0.021, 0.019));
    const umiya = await business("both", "Umiya Cartons", "umiya@example.test", near(0.031, -0.014));
    const setu = await business("buyer", "Setu Recycling Works", "setu@example.test", near(0, 0));
    execFileSync(PY, ["set_admin.py", "admin", "admin"], {
      cwd: path.join(root, "services/api"), env: { ...process.env, ...serverEnv }, stdio: "ignore",
    });
    const admin = (await call("POST", "/auth/login", null, { email: "admin", password: "admin" })).token;

    // --- what they have ---------------------------------------------------
    const L = async (who, title, material_id, quantity, price, extra = {}) =>
      (await call("POST", "/listings", who.token, { title, material_id, quantity, price, ...extra })).id;
    const pet1 = await L(shree, "Sorted PET bottle flakes", "pet", 45, 24, { description: "Washed, labels removed. Stored dry." });
    await L(shree, "LDPE stretch film offcuts", "ldpe", 60, 14);
    const pet2 = await L(kalol, "Clear PET preform rejects", "pet", 40, 26);
    await L(kalol, "Rigid HDPE crates, cracked", "hdpe", 80, 19, { grade: "used_sorted" });
    const pet3 = await L(umiya, "PET strapping offcuts", "pet", 30, 22);
    await L(umiya, "Corrugated cardboard sheets", "cardboard", 150, 8);
    await L(umiya, "Wooden pallets 1200x1000", "pallet", 40, 180, { grade: "used_sorted", intent: "reuse" });

    // --- evidence, and a person checking it -------------------------------
    const photo = await upload(shree.token, path.join(tmp, "photo.jpg"), "photo", pet1);
    const slip = await upload(shree.token, path.join(tmp, "slip.jpg"), "weighing_slip", pet1);
    await upload(kalol.token, path.join(tmp, "photo.jpg"), "photo", pet2);
    await call("POST", "/me/gst", shree.token, { gstin: "24AAACS1234A1Z5" });
    await call("POST", "/me/gst", kalol.token, { gstin: "24AABCK5678B1Z3" });
    await call("POST", "/me/gst", umiya.token, { gstin: "24AADCU9012C1ZX" });
    const note = "Certificate checked against the GST register";
    await call("POST", `/admin/gst/${shree.id}`, admin, { approved: true, reference: note });
    for (const e of [photo, slip])
      await call("POST", `/admin/evidence/${e.id}`, admin, { approved: true, reference: "Photo matches listing; slip weight 45.3 kg" });

    // --- a finished deal, so trust has history behind it ------------------
    const done = await exchange(setu.token, {
      items: [{ listing_id: pet1, quantity: 10 }], pickup: "Collected Monday", idempotency_key: "shots-done-0001",
    });
    const item = done.items[0].id;
    await call("POST", `/exchange-items/${item}/action`, shree.token, { action: "accept" });
    await call("POST", `/exchange-items/${item}/action`, shree.token, { action: "confirm", actual: 10 });
    await call("POST", `/exchange-items/${item}/action`, setu.token, { action: "confirm", actual: 10 });
    await call("POST", "/reviews", setu.token, { item_id: item, rating: 5, comment: "Exactly as described, clean and dry." });

    // --- a pooled request, accepted by everyone in it ---------------------
    const pool = await exchange(setu.token, {
      items: [{ listing_id: pet2, quantity: 25 }, { listing_id: pet3, quantity: 5 }],
      pickup: "Our truck, Friday 10 am", idempotency_key: "shots-pool-0001",
    });
    const owners = { [kalol.id]: kalol.token, [umiya.id]: umiya.token };
    for (const i of pool.items) await call("POST", `/exchange-items/${i.id}/action`, owners[i.seller_id], { action: "accept" });

    browser = await chromium.launch();
    const errors = [];
    const page = async (token, width = 1280, height = 820, key = "materialsetu-token", base = WEB) => {
      const p = await browser.newPage({ viewport: { width, height } });
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base);
      if (token) {
        await p.evaluate(([k, t]) => localStorage.setItem(k, t), [key, token]);
        await p.reload();
      }
      return p;
    };
    console.log("photographing each panel");

    // Visitor: creating an account, choosing a side.
    {
      const p = await page(null);
      await p.waitForSelector("aside nav button");
      await p.getByRole("button", { name: "Sign in", exact: true }).first().click();
      await p.getByText(/Create account/i).click();
      await p.waitForSelector(".kind-choice");
      await p.locator(".kind-choice button").first().click();
      await shot(p, "web-roles.png");
      await p.close();
    }
    // Collector: search, pooled plans, trust.
    {
      const p = await page(setu.token, 1280, 900);
      await expect(p.locator("aside nav button").first()).toHaveText(/Find materials/);
      await p.getByLabel("Describe material demand").fill("50 kg PET within 30 km");
      await p.locator(".search-line button").click();
      await expect(p.locator(".pool-card").first()).toContainText("PET");
      await p.waitForTimeout(600);
      await shot(p, "web-marketplace.png");
      await p.locator(".listing-card").filter({ hasText: "Sorted PET bottle flakes" }).click();
      await expect(p.getByRole("dialog")).toContainText("GST");
      await p.locator(".trust-panel").scrollIntoViewIfNeeded();
      await p.waitForTimeout(900);
      await shot(p, "web-trust.png");
      await p.getByLabel("Close dialog").click();
      await p.getByRole("button", { name: "Exchanges" }).first().click();
      await expect(p.locator(".exchange").first()).toBeVisible();
      await p.waitForTimeout(600);
      await shot(p, "web-exchange.png");
      await p.setViewportSize({ width: 390, height: 844 });
      await p.getByRole("button", { name: "Open navigation" }).click().catch(() => {});
      await p.keyboard.press("Escape");
      await p.goto(WEB);
      await expect(p.locator(".listing-card").first()).toBeVisible();
      await p.waitForTimeout(600);
      await shot(p, "web-phone.png");
      await p.close();
    }
    // Generator: their own listings and nothing to search.
    {
      const p = await page(umiya.token);
      await p.getByRole("button", { name: "My listings" }).click();
      await p.waitForTimeout(1200);
      await shot(p, "web-generator.png");
      await p.close();
    }
    // Reviewer: one screen, a GST record open for management.
    {
      const p = await page(admin, 1280, 900);
      await expect(p.locator("aside nav button")).toHaveCount(1);
      await p.locator("tr").filter({ hasText: "Kalol Plastics" }).getByRole("button", { name: "GST" }).click();
      await p.locator(".gst-manager input").first().fill(note);
      await p.locator(".gst-manager").scrollIntoViewIfNeeded();
      await p.evaluate(() => window.scrollBy(0, -260));
      await p.waitForTimeout(500);
      await shot(p, "web-review-centre.png");
      await p.close();
    }
    // The app, on a phone.
    if (mobile) {
      const key = "materialsetu-mobile-token";
      const c = await page(setu.token, 390, 844, key, APP);
      await expect(c.getByText("PET", { exact: true }).first()).toBeVisible({ timeout: 60000 });
      await c.waitForTimeout(1500);
      await shot(c, "app-discover.png");
      await c.getByRole("tab", { name: /Pools/ }).click();
      await c.waitForTimeout(1500);
      await shot(c, "app-pools.png");
      await c.close();
      const r = await page(admin, 390, 844, key, APP);
      await r.getByRole("tab", { name: /Review/ }).click();
      await expect(r.getByText("Review centre.")).toBeVisible({ timeout: 60000 });
      await r.waitForTimeout(1200);
      await shot(r, "app-review.png");
      await r.close();
    } else console.log("  (apps/mobile/dist missing - app screenshots skipped)");

    if (errors.length) throw new Error("page errors: " + errors.join(" | "));
    console.log("done");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const k of kids) k.kill("SIGTERM");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
