import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * One source, every browser.
 *
 *   node build.mjs                  Chrome, Edge, Brave, Opera, Arc  -> dist/
 *   node build.mjs --target firefox Firefox 128+                      -> dist-firefox/
 *   node build.mjs --target safari  Safari 17+ (convert with Xcode)   -> dist-safari/
 *   node build.mjs --target all     all three
 *
 * Chrome stays in dist/ so an unpacked install keeps its extension ID, and
 * with it your wardrobe and history.
 */

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const t = args[args.indexOf("--target") + 1];
const targets = args.includes("--target") ? (t === "all" ? ["chrome", "firefox", "safari"] : [t]) : ["chrome"];
const OUT = { chrome: "dist", firefox: "dist-firefox", safari: "dist-safari" };

const base = JSON.parse(readFileSync("static/manifest.json", "utf8"));

/**
 * Google sign-in (Google Photos, Drive). google.json holds Zero Q's own OAuth
 * client ID. Once it is filled in, the Chrome build gets a fixed key, so every
 * install has the same extension ID and the one redirect address registered
 * with Google works for everyone. ZQ_GOOGLE_CLIENT_ID overrides the file.
 * See docs/google-photos.md.
 */
const google = JSON.parse(readFileSync("google.json", "utf8"));
const googleClientId = (process.env.ZQ_GOOGLE_CLIENT_ID ?? google.clientId ?? "").trim();

function manifestFor(target) {
  const m = structuredClone(base);
  const drop = (list, ...names) => list.filter((p) => !names.includes(p));
  if (target === "chrome" && googleClientId && google.chromeKey) m.key = google.chromeKey;
  if (target === "firefox") {
    delete m.side_panel;
    delete m.minimum_chrome_version;
    // Firefox cannot pick folders; it saves a daily backup to Downloads/Zero Q instead.
    m.permissions = [...drop(m.permissions, "sidePanel"), "downloads"];
    m.background = { scripts: ["background.js"] };
    m.sidebar_action = { default_panel: "sidepanel.html", default_title: "Zero Q", default_icon: m.icons, open_at_install: false };
    const { _execute_action, ...rest } = m.commands;
    m.commands = { _execute_sidebar_action: { ..._execute_action, description: "Open Zero Q" }, ...rest };
    m.browser_specific_settings = { gecko: { id: "zeroq@zeroq.app", strict_min_version: "128.0" } };
  }
  if (target === "safari") {
    delete m.side_panel;
    delete m.minimum_chrome_version;
    // Safari has no side panel and no web sign-in for extensions: Zero Q opens in a tab, Drive sync is off.
    m.permissions = drop(m.permissions, "sidePanel", "identity");
    m.browser_specific_settings = { safari: { strict_min_version: "17.0" } };
  }
  return m;
}

/**
 * The face models that find you in group photos. They ship inside the
 * extension, so finding you works offline and no photo leaves the browser for it.
 */
const FACE_MODELS = ["ssd_mobilenetv1_model", "face_landmark_68_model", "face_recognition_model"];
const need = createRequire(import.meta.url);
const faceModelDir = join(dirname(need.resolve("@vladmandic/face-api/package.json")), "model");
/** WebAssembly runtime for computers without a usable graphics chip. Threads are left out: they need page isolation the extension does not use. */
const WASM = ["tfjs-backend-wasm.wasm", "tfjs-backend-wasm-simd.wasm"];
const wasmDir = join(dirname(need.resolve("@tensorflow/tfjs-backend-wasm/package.json")), "dist");

async function build(target) {
  const out = OUT[target];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync("static", out, { recursive: true });
  mkdirSync(`${out}/models`, { recursive: true });
  mkdirSync(`${out}/wasm`, { recursive: true });
  for (const f of WASM) cpSync(join(wasmDir, f), `${out}/wasm/${f}`);
  for (const m of FACE_MODELS) for (const f of [`${m}-weights_manifest.json`, `${m}.bin`]) cpSync(join(faceModelDir, f), `${out}/models/${f}`);
  // their licences travel with them
  cpSync(join(faceModelDir, "..", "LICENSE"), `${out}/models/LICENSE-face-api.txt`);
  writeFileSync(`${out}/models/NOTICE.txt`, [
    "The face models in this folder and the code that runs them come from:",
    "",
    "face-api, by Vladimir Mandic, based on face-api.js by Vincent Muehler. MIT licence (see LICENSE-face-api.txt).",
    "https://github.com/vladmandic/face-api",
    "",
    "TensorFlow.js, by Google LLC. Apache License 2.0.",
    "https://github.com/tensorflow/tfjs",
    "https://www.apache.org/licenses/LICENSE-2.0",
    "",
  ].join("\n"));
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifestFor(target), null, 2));
  const ctx = await esbuild.context({
    entryPoints: { background: "src/background.ts", content: "src/content.ts", ui: "src/ui/main.tsx", faces: "src/faces-worker.ts" },
    outdir: out,
    bundle: true,
    format: "iife",
    target: ["chrome116", "firefox128", "safari17"],
    jsx: "automatic",
    minify: !watch,
    sourcemap: watch ? "inline" : false,
    loader: { ".css": "css" },
    external: ["/fonts/*"],
    define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"', __TARGET__: JSON.stringify(target), __ZQ_GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId) },
    logLevel: "info",
  });
  if (watch) await ctx.watch();
  else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

for (const target of targets) {
  if (!OUT[target]) throw new Error(`Unknown target "${target}". Use chrome, firefox, safari or all.`);
  await build(target);
}
