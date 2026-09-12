/** Lays generated voiceover clips onto the demo video at their marked times.
 *
 * Generate one audio file per segment (Sarvam, ElevenLabs, a microphone — it does
 * not matter) and name it after the segment id:
 *
 *     docs/voiceover/en/01-open.wav   docs/voiceover/hi/01-open.wav
 *     docs/voiceover/en/02-problem.wav              ... and so on
 *
 * Then:
 *
 *     export FFMPEG=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
 *     node scripts/merge-voiceover.cjs en
 *
 * Leaves docs/demo-video-en.mp4. The video stream is copied, never re-encoded, so
 * this is quick and loses nothing.
 *
 * Any clip longer than its shot is reported rather than silently talked over the
 * next one; shorten the reading or widen the shot in scripts/record-demo.cjs.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const lang = (process.argv[2] || "en").toLowerCase();
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const spec = JSON.parse(
  fs.readFileSync(path.join(root, "docs/voiceover/segments.json"), "utf8"),
);
const video = path.join(root, spec.video);
const dir = path.join(root, "docs/voiceover", lang);
const out = path.join(root, `docs/demo-video-${lang}.mp4`);

function seconds(file) {
  const probe = execFileSync(ffmpeg, ["-hide_banner", "-i", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  return 0; // ffmpeg prints to stderr; handled below
}

function duration(file) {
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(e.stderr?.toString() || "");
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return null;
}

const clips = [];
const missing = [];
for (const s of spec.segments) {
  const found = [".wav", ".mp3", ".m4a", ".ogg", ".flac"]
    .map((ext) => path.join(dir, s.id + ext))
    .find((f) => fs.existsSync(f));
  if (!found) {
    missing.push(s.id);
    continue;
  }
  clips.push({ ...s, file: found, length: duration(found) });
}

if (missing.length) {
  console.error(`Missing audio in docs/voiceover/${lang}/ for: ${missing.join(", ")}`);
  console.error("Generate those first, or drop them from segments.json.");
  process.exit(1);
}

let over = 0;
for (const c of clips) {
  if (c.length && c.length > c.budget) {
    console.error(
      `  ${c.id}: clip is ${c.length.toFixed(1)}s but the shot is ${c.budget}s ` +
        `(${(c.length - c.budget).toFixed(1)}s too long)`,
    );
    over++;
  }
}
if (over) {
  console.error(
    `\n${over} clip(s) run past their shot. Shorten the reading, or widen the ` +
      `shot in scripts/record-demo.cjs and re-record.`,
  );
  process.exit(1);
}

// One input per clip, each delayed to its start, all mixed into a single track.
const inputs = clips.flatMap((c) => ["-i", c.file]);
const delays = clips
  .map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.start * 1000)}|${Math.round(c.start * 1000)}[a${i}]`)
  .join(";");
const mix =
  clips.map((_, i) => `[a${i}]`).join("") +
  `amix=inputs=${clips.length}:dropout_transition=0:normalize=0[out]`;

execFileSync(
  ffmpeg,
  [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", video, ...inputs,
    "-filter_complex", `${delays};${mix}`,
    "-map", "0:v", "-map", "[out]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
    "-movflags", "+faststart",
    out,
  ],
  { stdio: "inherit" },
);

const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`docs/demo-video-${lang}.mp4  ${mb} MB  (${clips.length} clips placed)`);
