#!/usr/bin/env node
// recon-registry — package a Foundry harness/mock into a registry entry and publish it.
//
//   npx recon-registry init      scaffold manifest + harness template (run in a Foundry project)
//   npx recon-registry pack      forge build + extract a schema-valid entry JSON
//   npx recon-registry publish   open a PR to the registry repo with the entry
//   npx recon-registry list      list published entries
//
// Zero runtime deps: Node builtins + shelling out to `forge` and `gh`.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(__dir, "..", "templates");
const DEFAULT_REGISTRY = "Recon-Fuzz/recon-registry";

const die = (m) => { console.error(`recon-registry: ${m}`); process.exit(1); };
const ok = (m) => console.log(`✓ ${m}`);

// --- tiny flat-TOML reader (enough for recon-registry.toml: [section] key = "..." | [..]) ---
function readToml(path) {
  const out = {};
  let section = "";
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1]; out[section] = out[section] || {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    let val;
    if (v.startsWith("[")) val = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else val = v.replace(/^["']|["']$/g, "");
    (section ? out[section] : out)[k] = val;
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

// --- cross-platform helpers (macOS / Linux / Windows) ---
function copyToClipboard(text) {
  const p = process.platform;
  const cands =
    p === "darwin" ? [["pbcopy", []]]
    : p === "win32" ? [["clip", []]]
    : [["xclip", ["-selection", "clipboard"]], ["wl-copy", []], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of cands) {
    try { execFileSync(cmd, args, { input: text, shell: p === "win32" }); return true; } catch {}
  }
  return false;
}
function openUrl(url) {
  const p = process.platform;
  try {
    if (p === "darwin") execFileSync("open", [url], { stdio: "ignore" });
    else if (p === "win32") execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    else execFileSync("xdg-open", [url], { stdio: "ignore" });
  } catch {}
}
// Reveal a file in the OS file manager, selected/highlighted so it's ready to drag.
function revealFile(p) {
  const plat = process.platform;
  try {
    if (plat === "darwin") execFileSync("open", ["-R", p], { stdio: "ignore" });
    else if (plat === "win32") execFileSync("explorer", [`/select,${p}`], { stdio: "ignore" });
    else execFileSync("xdg-open", [dirname(p)], { stdio: "ignore" }); // most Linux FMs lack --select
  } catch {}
}

// ---------------------------------------------------------------- init
function init() {
  if (!existsSync("foundry.toml")) die("run inside a Foundry project (no foundry.toml found)");
  mkdirSync("registry", { recursive: true });
  const files = [
    ["recon-registry.toml", "recon-registry.toml"],
    [join("registry", "Harness.sol"), "Harness.sol"],
    [join("registry", "Rvm.sol"), "Rvm.sol"],
    [join("registry", "IERC20.sol"), "IERC20.sol"],
    [join("registry", "README.md"), "registry-README.md"],
  ];
  for (const [dst, tpl] of files) {
    if (existsSync(dst)) { console.log(`· skip ${dst} (exists)`); continue; }
    copyFileSync(join(TEMPLATES, tpl), dst);
    ok(`created ${dst}`);
  }
  // Best-effort: prefill author from git config (only replaces the untouched placeholder).
  try {
    const n = sh("git", ["config", "user.name"]).trim();
    const e = sh("git", ["config", "user.email"]).trim();
    const a = n ? (e ? `${n} <${e}>` : n) : "";
    const t = existsSync("recon-registry.toml") ? readFileSync("recon-registry.toml", "utf8") : "";
    if (a && t.includes("Your Name <you@example.com>")) {
      writeFileSync("recon-registry.toml", t.replace("Your Name <you@example.com>", a));
      ok(`author = ${a}`);
    }
  } catch {}

  console.log("\nNext: edit recon-registry.toml + registry/Harness.sol, then `npx recon-registry pack`.");
}

// ---------------------------------------------------------------- pack
function pack() {
  if (!existsSync("recon-registry.toml")) die("no recon-registry.toml — run `npx recon-registry init` first");
  const m = readToml("recon-registry.toml");
  const name = m.entry?.name || die("recon-registry.toml: [entry].name required");
  const harness = m.entry?.harness || die("recon-registry.toml: [entry].harness required");
  const skip = (m.build?.skip || []).flatMap((s) => ["--skip", s]);

  console.log(`Building (forge build ${skip.join(" ")}) ...`);
  sh("forge", ["build", ...skip], { stdio: ["ignore", "inherit", "inherit"] });

  // Locate the concrete artifact for the harness contract.
  const artifact = findArtifact("out", harness) || die(`artifact for ${harness} not found under out/`);
  const a = JSON.parse(readFileSync(artifact, "utf8"));
  const bytecode = a.bytecode?.object || "";
  if (bytecode.replace(/^0x/, "").length === 0)
    die(`${harness} has empty bytecode (abstract contract or basename collision — check [build].skip)`);
  if (bytecode.includes("__$")) die(`${harness} has unlinked libraries — link them before packing`);

  // Inline the FLATTENED source — self-contained (full dependency tree in one file), so CI can
  // recompile it standalone to verify the bytecode, and humans/LLM see everything.
  const sourcePath = m.entry?.source || guessSource(harness);
  let source = "";
  if (sourcePath && existsSync(sourcePath)) {
    try { source = sh("forge", ["flatten", sourcePath]); }
    catch { source = readFileSync(sourcePath, "utf8"); }
  }

  const entry = {
    name,
    description: m.entry?.description || "",
    author: m.entry?.author || "",
    tags: m.entry?.tags || [],
    labels: m.entry?.labels || [],
    abi: a.abi,
    creationBytecode: bytecode,
    source,
    solc: m.build?.solc || readToml("foundry.toml").profile?.default?.solc || detectSolc(),
  };
  mkdirSync("recon-registry-out", { recursive: true });
  const out = join("recon-registry-out", `${name}.json`);
  writeFileSync(out, JSON.stringify(entry, null, 1));
  ok(`packed ${out} (${(bytecode.length / 2) | 0} bytes bytecode, ${entry.abi.length} abi items)`);
  if (!source) console.log("· note: no source inlined — set [entry].source in the manifest for transparency");
}

// ---------------------------------------------------------------- publish
// Two tiers, no `gh`/`git`, cross-platform:
//   1. If a write token is available (GH_TOKEN/GITHUB_TOKEN), fire a `repository_dispatch` →
//      the registry Action validates + opens the PR fully automatically (no UI step).
//   2. Otherwise, copy the entry JSON to the clipboard and open the prefilled "Submit a
//      registry entry" issue — the user clicks the field, Ctrl/Cmd+V, Submit; the Action
//      turns the issue into a PR.
async function publish() {
  const built = existsSync("recon-registry-out") && readdirSync("recon-registry-out").find((f) => f.endsWith(".json"));
  if (!built) die("nothing packed — run `npx recon-registry pack` first");
  const m = existsSync("recon-registry.toml") ? readToml("recon-registry.toml") : {};
  const repo = m.registry?.repo || DEFAULT_REGISTRY;
  const name = built.replace(/\.json$/, "");
  const file = join("recon-registry-out", built);
  const jsonText = readFileSync(file, "utf8");
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  // Tier 1: repository_dispatch (needs write access).
  if (token) {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "recon-registry",
      },
      body: JSON.stringify({ event_type: "submit-entry", client_payload: { entry: JSON.parse(jsonText) } }),
    });
    if (res.status === 204) {
      ok(`dispatched '${name}' — the registry Action will validate it and open a PR.`);
      return;
    }
    console.log(`· repository_dispatch not permitted (HTTP ${res.status}); falling back to the issue flow.`);
  }

  // Tier 2: open the markdown issue page AND reveal the entry file in the file manager so the
  // user just drags it into the issue body and submits. The Action downloads + parses the
  // attached file (drag-dropped .json works) and opens the PR. No clipboard/token/gh needed.
  const url = `https://github.com/${repo}/issues/new?template=submit-entry.md&title=${encodeURIComponent(`[entry] ${name}`)}`;
  const abs = resolve(file);
  console.log(`\nSubmit '${name}':`);
  console.log(`  1. Opening the issue page + your file manager (the entry file is highlighted).`);
  console.log(`  2. Drag this file into the issue body, then click "Submit new issue":`);
  console.log(`       ${abs}`);
  console.log(`  3. A bot downloads it, validates it, and opens the PR.\n`);
  openUrl(url);
  revealFile(abs);
}

// ---------------------------------------------------------------- list
async function list() {
  const m = existsSync("recon-registry.toml") ? readToml("recon-registry.toml") : {};
  const repo = m.registry?.repo || DEFAULT_REGISTRY;
  const url = `https://raw.githubusercontent.com/${repo}/main/registry.json`;
  const res = await fetch(url, { headers: { "User-Agent": "recon-registry" } });
  if (!res.ok) die(`could not fetch ${url} (HTTP ${res.status})`);
  const { entries = [] } = await res.json();
  if (!entries.length) return console.log("(registry is empty)");
  for (const e of entries) console.log(`${e.name}\t[${(e.tags || []).join(", ")}]\t${e.description || ""}`);
}

// ---------------------------------------------------------------- helpers
function findArtifact(root, contract) {
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, d.name);
    if (d.isDirectory()) { const r = findArtifact(p, contract); if (r) return r; }
    else if (d.name === `${contract}.json`) return p;
  }
  return null;
}
function guessSource(contract) {
  for (const root of ["registry", "src", "test"]) {
    const r = findArtifact.call(null, root, contract); // reuse: look for <contract>.sol
    if (existsSync(join(root, `${contract}.sol`))) return join(root, `${contract}.sol`);
  }
  return null;
}
function detectSolc() {
  try { return (sh("forge", ["--version"]).match(/solc\s+([0-9.]+)/) || [])[1] || ""; } catch { return ""; }
}

const USAGE = "usage: recon-registry <init|pack|publish|list> | --version";
const [, , cmd] = process.argv;
if (cmd === "--version" || cmd === "-v") {
  const pkg = JSON.parse(readFileSync(resolve(__dir, "..", "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(USAGE); process.exit(0); }
const fn = { init, pack, publish, list }[cmd];
if (!fn) die(`unknown command '${cmd}'. ${USAGE}`);
await fn();
