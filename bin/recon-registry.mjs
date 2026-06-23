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

// ---------------------------------------------------------------- init
function init() {
  if (!existsSync("foundry.toml")) die("run inside a Foundry project (no foundry.toml found)");
  mkdirSync("registry", { recursive: true });
  const files = [
    ["recon-registry.toml", "recon-registry.toml"],
    [join("registry", "Harness.sol"), "Harness.sol"],
    [join("registry", "Rvm.sol"), "Rvm.sol"],
    [join("registry", "README.md"), "registry-README.md"],
  ];
  for (const [dst, tpl] of files) {
    if (existsSync(dst)) { console.log(`· skip ${dst} (exists)`); continue; }
    copyFileSync(join(TEMPLATES, tpl), dst);
    ok(`created ${dst}`);
  }
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

  // Inline FLATTENED source so it's self-contained: CI can recompile it standalone and verify
  // the bytecode, and humans/LLM see every dependency in one file.
  const sourcePath = m.entry?.source || guessSource(harness);
  let source = "";
  if (sourcePath && existsSync(sourcePath)) {
    try { source = sh("forge", ["flatten", sourcePath]); }
    catch { source = readFileSync(sourcePath, "utf8"); }
  }

  const entry = {
    name,
    description: m.entry?.description || "",
    tags: m.entry?.tags || [],
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
function publish() {
  const built = existsSync("recon-registry-out") && readdirSync("recon-registry-out").find((f) => f.endsWith(".json"));
  if (!built) die("nothing packed — run `npx recon-registry pack` first");
  const m = readToml("recon-registry.toml");
  const repo = m.registry?.repo || DEFAULT_REGISTRY;
  const name = built.replace(/\.json$/, "");
  try { sh("gh", ["--version"]); } catch { die("`gh` (GitHub CLI) is required for publish — https://cli.github.com"); }

  console.log(`Opening PR to ${repo} for entry '${name}' ...`);
  // Fork+clone the registry, add the entry on a branch, push, open PR.
  const tmp = sh("mktemp", ["-d"]).trim();
  sh("gh", ["repo", "fork", repo, "--clone", "--remote", "--", join(tmp, "registry")], { stdio: ["ignore", "inherit", "inherit"] });
  const dir = join(tmp, "registry");
  const branch = `entry/${name}`;
  sh("git", ["-C", dir, "checkout", "-b", branch]);
  mkdirSync(join(dir, "entries"), { recursive: true });
  copyFileSync(join("recon-registry-out", built), join(dir, "entries", built));
  sh("git", ["-C", dir, "add", join("entries", built)]);
  sh("git", ["-C", dir, "commit", "-m", `Add ${name} entry`]);
  sh("git", ["-C", dir, "push", "-u", "origin", branch]);
  sh("gh", ["pr", "create", "--repo", repo, "--title", `Add ${name}`, "--body",
    `Adds registry entry \`${name}\`.\n\n- description: ${m.entry?.description || ""}\n- tags: ${(m.entry?.tags || []).join(", ")}\n\nCI verifies bytecode == recompile(source, solc).`],
    { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
  ok(`PR opened for ${name}`);
}

// ---------------------------------------------------------------- list
function list() {
  const m = existsSync("recon-registry.toml") ? readToml("recon-registry.toml") : {};
  const repo = m.registry?.repo || DEFAULT_REGISTRY;
  const url = `https://raw.githubusercontent.com/${repo}/main/registry.json`;
  console.log(`Fetching ${url} ...`);
  sh("sh", ["-c", `curl -fsSL ${url} | (command -v jq >/dev/null && jq -r '.entries[] | "\\(.name)  [\\(.tags|join(\\", \\"))]  \\(.description)"' || cat)`],
    { stdio: ["ignore", "inherit", "inherit"] });
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

const [, , cmd] = process.argv;
const fn = { init, pack, publish, list }[cmd];
if (!fn) die(`unknown command '${cmd ?? ""}'. usage: recon-registry <init|pack|publish|list>`);
fn();
