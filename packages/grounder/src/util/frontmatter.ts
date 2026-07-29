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

/**
 * Parse `title` / `created` from Grounder handoff frontmatter.
 * Accepts the quoted `key: "value"` shape {@link writeHandoff} writes today, and
 * unquoted `key: value` from earlier handoffs. Not a general YAML parser.
 * Returns `{}` on anything unexpected; never throws.
 */
export function parseHandoffFrontmatter(content: string): { title?: string; created?: string } {
  try {
    const lines = content.split(/\r?\n/);
    if (lines[0] !== "---") {
      return {};
    }

    const result: { title?: string; created?: string } = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line === "---") {
        break;
      }

      const quoted = /^(title|created):\s*"(.*)"\s*$/.exec(line);
      if (quoted) {
        const key = quoted[1] as "title" | "created";
        result[key] = unescapeYamlDoubleQuoted(quoted[2] ?? "");
        continue;
      }

      // Opening quote without a closing pair — ignore rather than treat as unquoted.
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
