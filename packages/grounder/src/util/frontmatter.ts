/**
 * Unescape sequences produced by {@link yamlDoubleQuoted}: `\\`, `\"`, `\r`, `\n`.
 */
function unescapeYamlDoubleQuoted(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "\\" || next === '"') {
        result += next;
        i++;
        continue;
      }
      if (next === "n") {
        result += "\n";
        i++;
        continue;
      }
      if (next === "r") {
        result += "\r";
        i++;
        continue;
      }
    }
    result += value[i];
  }
  return result;
}

export interface ParsedFrontmatter {
  title?: string;
  created?: string;
  topics?: string[];
}

/**
 * Parse a YAML flow sequence like `["a", "b"]` or `[a, b]` into a string array.
 * Returns `undefined` on anything unexpected.
 */
function parseYamlFlowSequence(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  const inner = trimmed.slice(1, -1);
  if (!inner.trim()) return [];
  return inner.split(",").map((item) => {
    const s = item.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      return unescapeYamlDoubleQuoted(s.slice(1, -1));
    }
    return s;
  });
}

/**
 * Parse `title` / `created` / `topics` from Grounder frontmatter.
 * Accepts the quoted `key: "value"` shape write commands produce, and
 * unquoted `key: value` from earlier files. Not a general YAML parser.
 * Returns `{}` on anything unexpected; never throws.
 */
export function parseHandoffFrontmatter(content: string): ParsedFrontmatter {
  try {
    const lines = content.split(/\r?\n/);
    if (lines[0] !== "---") {
      return {};
    }

    const result: ParsedFrontmatter = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line === "---") {
        break;
      }

      const topicsMatch = /^topics:\s*(\[.*\])\s*$/.exec(line);
      if (topicsMatch) {
        const parsed = parseYamlFlowSequence(topicsMatch[1] ?? "");
        if (parsed) result.topics = parsed;
        continue;
      }

      const quoted = /^(title|created):\s*"(.*)"\s*$/.exec(line);
      if (quoted) {
        const key = quoted[1] as "title" | "created";
        result[key] = unescapeYamlDoubleQuoted(quoted[2] ?? "");
        continue;
      }

      if (/^(title|created):\s*"/.test(line)) {
        continue;
      }

      const unquoted = /^(title|created):\s*(.+?)\s*$/.exec(line);
      if (unquoted) {
        const key = unquoted[1] as "title" | "created";
        result[key] = unquoted[2] ?? "";
      }
    }

    return result;
  } catch {
    return {};
  }
}
