import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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

function manifestFor(target) {
  const m = structuredClone(base);
  const drop = (list, ...names) => list.filter((p) => !names.includes(p));
  if (target === "firefox") {
    delete m.side_panel;
    delete m.minimum_chrome_version;
    m.permissions = drop(m.permissions, "sidePanel");
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

async function build(target) {
  const out = OUT[target];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync("static", out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifestFor(target), null, 2));
  const ctx = await esbuild.context({
    entryPoints: { background: "src/background.ts", content: "src/content.ts", ui: "src/ui/main.tsx" },
    outdir: out,
    bundle: true,
    format: "iife",
    target: ["chrome116", "firefox128", "safari17"],
    jsx: "automatic",
    minify: !watch,
    sourcemap: watch ? "inline" : false,
    loader: { ".css": "css" },
    external: ["/fonts/*"],
    define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"', __TARGET__: JSON.stringify(target) },
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
