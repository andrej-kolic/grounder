/**
 * Double-quote a YAML scalar and escape `\`, `"`, and newlines.
 * Always quoted so values with `:`, `#`, leading spaces, etc. stay valid.
 */
export function yamlDoubleQuoted(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}
