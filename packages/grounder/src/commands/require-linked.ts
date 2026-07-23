import { type LinkedProject, resolveLinkedProject } from "../connector/linked.js";

/**
 * Resolves the linked project for CLI commands.
 * Writes the standard stderr hints and returns `null` on failure.
 */
export async function requireLinkedProject(cwd: string): Promise<LinkedProject | null> {
  const result = await resolveLinkedProject(cwd);
  if (!result.ok) {
    if (result.error === "no-vault") {
      process.stderr.write("No vault configured. Run: grounder vault init <path>\n");
    } else {
      process.stderr.write("Folder not linked. Run: grounder init\n");
    }
    return null;
  }
  return result.value;
}
