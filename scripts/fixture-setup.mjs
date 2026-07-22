#!/usr/bin/env node

process.stdout.write("fixtures/dev: ready\n");
process.stdout.write("\nNext steps:\n");
process.stdout.write("  pnpm grounder vault init ~/Documents/obsidian/dev --yes\n");
process.stdout.write("  cd fixtures/dev && pnpm grounder init --yes\n");
process.stdout.write('  pnpm grounder note "hello from dev fixture"\n');
process.stdout.write(
  '  pnpm grounder handoff "# Handoff\\n\\n## Next\\n1. Try /grounder-task next session"\n',
);
process.stdout.write("  pnpm grounder handoff list\n");
