/** Records a pitch video of the real product, driven through a real browser.
 *
 * Nothing here is mocked: it starts its own API on a throwaway database, seeds
 * the demo records, and then performs the whole exchange — buyer, two suppliers
 * and the reviewer — while recording. The timings below are also the timings the
 * voiceover script is written against, so the words land on the right shot.
 *
 *     node scripts/record-demo.cjs
 *
 * Leaves docs/demo-video.mp4. There is no audio: record the voiceover over it
 * using docs/demo-script.md.
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "materialsetu-film-"));
const out = path.join(root, "docs");
const children = [];

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
  for (let i = 0; i < 250; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start: " + url);
}

/** A full-frame caption. Shown in the same recording so there is nothing to cut. */
function card(kicker, headline, sub) {
  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap">
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:#0f3d31;color:#fff;
       font-family:Archivo,system-ui,sans-serif;text-align:center;padding:0 8%}
  .k{font-size:13px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#7fbda6;margin-bottom:20px}
  h1{font-size:${headline.length > 44 ? 44 : 58}px;font-weight:700;line-height:1.12;letter-spacing:-.025em;margin:0;text-wrap:balance}
  p{margin:22px 0 0;font-size:20px;line-height:1.55;color:#b9d3c9;max-width:24ch;margin-inline:auto}
  .mark{width:62px;height:62px;border-radius:17px;background:#fff;color:#0f3d31;display:grid;place-items:center;
        font-size:30px;font-weight:700;margin:0 auto 26px}
</style>
<div>
  ${kicker === "brand" ? '<div class="mark">M</div>' : `<div class="k">${kicker}</div>`}
  <h1>${headline}</h1>
  ${sub ? `<p>${sub}</p>` : ""}
</div>`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let t0 = 0;
const mark = (name) => {
  const t = (Date.now() - t0) / 1000;
  console.log(
    `  ${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}  ${name}`,
  );
};

(async () => {
  let browser, context;
  try {
    start(
      process.env.PYTHON || "python3",
      ["-m", "uvicorn", "main:app", "--port", "8131"],
      path.join(root, "services/api"),
      {
        DEMO_MODE: "1",
        DATABASE_URL: "sqlite:///" + path.join(tmp, "film.db"),
        UPLOAD_DIR: path.join(tmp, "uploads"),
        SUPABASE_URL: "",
        SUPABASE_SERVICE_KEY: "",
      },
    );
    fs.writeFileSync(
      path.join(root, "apps/web/vite.film.config.ts"),
      `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n` +
        `export default defineConfig({ plugins: [react()], server: { port: 5291, proxy: { "/api": "http://127.0.0.1:8131" } } });\n`,
    );
    start(
      process.execPath,
      [
        path.join(root, "node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        "5291",
        "--config",
        "vite.film.config.ts",
      ],
      path.join(root, "apps/web"),
    );
    await Promise.all([
      ready("http://localhost:8131/api/health"),
      ready("http://localhost:5291"),
    ]);

    browser = await chromium.launch();
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: tmp, size: { width: 1280, height: 720 } },
      deviceScaleFactor: 1,
    });
    const p = await context.newPage();
    t0 = Date.now();
    const site = "http://localhost:5291";
    const show = async (html, ms) => {
      await p.setContent(html);
      await wait(ms);
    };

    // 00:00 — who this is
    mark("brand card");
    await show(
      card("brand", "MaterialSetu", "A local exchange for surplus packaging material"),
      5400,
    );

    // 00:04 — the problem, stated plainly
    mark("problem card");
    await show(
      card(
        "The problem",
        "One factory throws away what the factory next door is buying.",
        "Leftovers are too small to sell. Strangers are too risky to buy from.",
      ),
      9200,
    );

    // 00:10 — a buyer describes what they need
    mark("buyer types the request");
    await p.goto(site);
    await p.waitForSelector(".listing-card", { timeout: 60000 });
    await p.locator(".demo-bar select").selectOption("buyer");
    await p.waitForTimeout(1800);
    const box = p.getByLabel("Describe material demand");
    await box.click();
    await box.fill("");
    await box.type("50 kg PET within 30 km", { delay: 55 });
    await wait(700);
    await p.locator(".search-line button").click();
    await p.waitForTimeout(5600);

    // 00:20 — no single supplier has enough, so combine them
    mark("supply plans");
    await p.locator(".pool-column").scrollIntoViewIfNeeded();
    await wait(8600);

    // 00:25 — why this supplier can be trusted
    mark("trust breakdown");
    await p.locator(".listing-card").first().click();
    await p.waitForTimeout(2200);
    await p.locator(".trust-panel").scrollIntoViewIfNeeded();
    await wait(7300);
    await p.getByLabel("Close dialog").click();
    await wait(900);

    // 00:33 — send the combined plan as one request
    mark("sending the request");
    await p.getByRole("button", { name: "Request this supply" }).first().click();
    await p.waitForTimeout(1300);
    await p
      .getByLabel("Proposed pickup arrangements")
      .type("Collection Friday, 10am, our truck", { delay: 35 });
    await wait(800);
    await p.getByRole("button", { name: "Send request", exact: true }).click();
    await p.waitForTimeout(2600);

    // 00:44 — each supplier answers for themselves; only now is stock held
    mark("suppliers accept");
    const order = await (
      await fetch("http://localhost:8131/api/exchanges", {
        headers: {
          Authorization:
            "Bearer " +
            (await p.evaluate(() => localStorage.getItem("materialsetu-token"))),
        },
      })
    ).json();
    const plan = order.find((e) => e.pickup.includes("Collection Friday"));
    for (const item of plan.items) {
      await p.locator(".demo-bar select").selectOption(item.seller_id);
      await p.waitForTimeout(1700);
      const row = p.locator(".exchange").filter({ hasText: "Collection Friday" });
      await row.getByRole("button", { name: "Accept & reserve", exact: true }).click();
      await p.waitForTimeout(2950);
    }

    // 00:56 — both sides must agree what actually changed hands
    mark("confirming the handover");
    const first = plan.items[0];
    await p.locator(".demo-bar select").selectOption(first.seller_id);
    await p.waitForTimeout(1600);
    const card1 = p.locator(".exchange").filter({ hasText: "Collection Friday" });
    const qty = card1.locator('input[type="number"]').first();
    await qty.fill("23");
    await wait(900);
    await card1.getByRole("button", { name: "Confirm handover" }).first().click();
    await p.waitForTimeout(2200);
    await p.locator(".demo-bar select").selectOption("buyer");
    await p.waitForTimeout(1700);
    const card2 = p.locator(".exchange").filter({ hasText: "Collection Friday" });
    await card2.locator('input[type="number"]').first().fill("23");
    await wait(800);
    await card2.getByRole("button", { name: "Confirm handover" }).first().click();
    await p.waitForTimeout(6200);

    // 01:10 — evidence is checked by a person before it counts
    mark("GST and the reviewer");
    await p.locator(".demo-bar select").selectOption("s3");
    await p.waitForTimeout(1600);
    await p.getByRole("button", { name: "Trust & verification" }).click();
    await p.waitForTimeout(1200);
    await p.getByLabel("GSTIN").fill("24ABCDE1234F1Z5");
    await wait(600);
    await p.getByRole("button", { name: "Submit GST details" }).click();
    await p.waitForTimeout(2200);
    await p.locator(".demo-bar select").selectOption("admin");
    await p.waitForTimeout(1800);
    await p.getByRole("button", { name: "Review centre" }).click();
    await p.waitForTimeout(2600);
    await p
      .locator(".admin-grid input[name='reference']")
      .first()
      .type("Certificate checked against the register", { delay: 28 });
    await wait(700);
    await p.getByRole("button", { name: "Approve review" }).first().click();
    await p.waitForTimeout(4900);

    // 01:28 — ask in your own language
    mark("language card");
    await show(
      card("Ask in your own language", "मुझे 20 लकड़ी के पैलेट चाहिए", "Hindi, Gujarati or English"),
      4600,
    );
    await p.goto(site);
    await p.waitForSelector(".listing-card", { timeout: 60000 });
    await p.locator(".demo-bar select").selectOption("buyer");
    await p.waitForTimeout(1600);
    const box2 = p.getByLabel("Describe material demand");
    await box2.fill("");
    await box2.type("मुझे 20 लकड़ी के पैलेट चाहिए", { delay: 60 });
    await wait(600);
    await p.locator(".search-line button").click();
    // Long enough to read the result, not just watch it arrive.
    await p.waitForTimeout(7600);

    // 01:40 — close
    mark("closing card");
    await show(
      card(
        "Try it",
        "material-setu-for-hack-out-26-web.vercel.app",
        "Website · Android APK · Team Tech Titans, Ganpat University",
      ),
      7200,
    );

    await context.close();
    const raw = fs.readdirSync(tmp).find((f) => f.endsWith(".webm"));
    const webm = path.join(tmp, raw);
    fs.mkdirSync(out, { recursive: true });
    const mp4 = path.join(out, "demo-video.mp4");

    const ffmpeg = process.env.FFMPEG;
    if (!ffmpeg) throw new Error("set FFMPEG to an ffmpeg binary with libx264");
    execFileSync(
      ffmpeg,
      [
        "-y", "-i", webm,
        "-vf", "scale=1280:720:flags=lanczos,fps=30",
        "-c:v", "libx264", "-preset", "slow", "-crf", "21",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        mp4,
      ],
      { stdio: "ignore" },
    );
    const size = (fs.statSync(mp4).size / 1024 / 1024).toFixed(1);
    console.log(`docs/demo-video.mp4  ${size} MB`);
  } catch (error) {
    console.error(error.message);
    console.error(children.map((c) => c.log).join("\n").slice(-1500));
    process.exitCode = 1;
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
    fs.rmSync(path.join(root, "apps/web/vite.film.config.ts"), { force: true });
    for (const c of children) c.kill("SIGTERM");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
