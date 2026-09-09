/**
 * Model catalog: one entry per model name, mapping to that model's `--model`
 * value on each host that can run it. Host and model are independent —
 * `resolveSweep` crosses them — because Grounder ships two separate skill
 * template trees (`templates/agents/claude/skills/*` vs
 * `templates/agents/cursor/skills/*`), so the same model behaving well on
 * one host says nothing about the other host's wording.
 *
 * cursor-agent has no Haiku 4.5 equivalent at the time this was written
 * (checked via `cursor-agent --list-models`), so haiku only has a `claude`
 * entry.
 */
const MODEL_CATALOG = {
  sonnet: { claude: "sonnet", "cursor-agent": "claude-sonnet-5-high" },
  opus: { claude: "opus", "cursor-agent": "claude-opus-5-high" },
  haiku: { claude: "haiku" },
  fable: { claude: "fable", "cursor-agent": "claude-fable-5-high" },
  grok: { "cursor-agent": "cursor-grok-4.6-high-fast" },
  "gemini 3.5 flash": { "cursor-agent": "gemini-3.5-flash" },
  "composer 2.5": { "cursor-agent": "composer-2.5-fast" },
  "gpt 5 mini": { "cursor-agent": "gpt-5-mini" },
};

export const HOSTS = ["claude", "cursor-agent"];

/** Crosses `MODEL_CATALOG` × host into flat sweep rows. Label stays bare when a model has only one host, gets a `(host)` suffix when it has more than one. */
function buildDefaultSweep() {
  const rows = [];
  for (const [name, byHost] of Object.entries(MODEL_CATALOG)) {
    const hosts = Object.keys(byHost);
    for (const host of hosts) {
      const label = hosts.length > 1 ? `${name} (${host})` : name;
      rows.push({ label, name, host, model: byHost[host] });
    }
  }
  return rows;
}

export const DEFAULT_SWEEP = buildDefaultSweep();

/** Comma-separated flag value (labels may contain spaces, so split only on ","). */
function parseCsvFlag(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || argv[index + 1] === undefined) {
    return null;
  }
  return argv[index + 1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const DEFAULT_CONCURRENCY = 4;

/** `--concurrency <n>` — how many probe runs may be in flight at once (default 4). */
export function resolveConcurrency(argv) {
  const index = argv.indexOf("--concurrency");
  if (index === -1 || argv[index + 1] === undefined) {
    return DEFAULT_CONCURRENCY;
  }
  const raw = argv[index + 1];
  // Match the whole token, not just its leading digits — `Number.parseInt`
  // alone would silently accept "1.5" as 1 or "4foo" as 4.
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`--concurrency must be a positive integer, got "${raw}".`);
  }
  return Number.parseInt(raw, 10);
}

/**
 * `--models <name-or-label,...>` narrows by model name (crosses every host
 * that supports it, e.g. `sonnet` alone still means both hosts) or by exact
 * label (e.g. `"sonnet (cursor-agent)"`, one host only). `--hosts <host,...>`
 * narrows by host, independently — combine both to pin an exact pair, e.g.
 * `--models sonnet --hosts cursor-agent`.
 */
export function resolveSweep(argv) {
  const wantedModels = parseCsvFlag(argv, "--models");
  const wantedHosts = parseCsvFlag(argv, "--hosts");

  if (wantedHosts) {
    const unknown = wantedHosts.filter((h) => !HOSTS.includes(h));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown --hosts value(s): ${unknown.join(", ")}. Known hosts: ${HOSTS.join(", ")}`,
      );
    }
  }

  let sweep = DEFAULT_SWEEP;
  if (wantedModels) {
    sweep = sweep.filter((e) => wantedModels.includes(e.name) || wantedModels.includes(e.label));
  }
  if (wantedHosts) {
    sweep = sweep.filter((e) => wantedHosts.includes(e.host));
  }

  if ((wantedModels || wantedHosts) && sweep.length === 0) {
    const names = [...new Set(DEFAULT_SWEEP.map((e) => e.name))];
    throw new Error(
      `--models/--hosts matched nothing. Known model names: ${names.join(", ")}. Known hosts: ${HOSTS.join(", ")}.`,
    );
  }
  return sweep;
}
