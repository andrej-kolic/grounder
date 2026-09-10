/** Markdown links (`[title](href)`) found under a `## <heading>` section of a final chat answer, in order. */
export function linksUnderHeading(body, heading) {
  const headingLine = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const match = headingLine.exec(body ?? "");
  if (!match) {
    return [];
  }
  const rest = body.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const links = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let linkMatch = linkPattern.exec(section);
  while (linkMatch !== null) {
    links.push({ title: linkMatch[1], href: linkMatch[2] });
    linkMatch = linkPattern.exec(section);
  }
  return links;
}

const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
  teeLeft: "┤",
  teeRight: "├",
};

function rule(widths, left, mid, right) {
  return left + widths.map((w) => BOX.horizontal.repeat(w + 2)).join(mid) + right;
}

function row(cells, widths) {
  return (
    BOX.vertical +
    cells.map((cell, i) => ` ${cell.padEnd(widths[i])} `).join(BOX.vertical) +
    BOX.vertical
  );
}

/** Renders `rows` (array of string arrays) with `header` as a Unicode box table. */
export function renderTable(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const lines = [
    rule(widths, BOX.topLeft, BOX.teeDown, BOX.topRight),
    row(header, widths),
    rule(widths, BOX.teeRight, BOX.cross, BOX.teeLeft),
    ...rows.map((r) => row(r.map(String), widths)),
    rule(widths, BOX.bottomLeft, BOX.teeUp, BOX.bottomRight),
  ];
  return lines.join("\n");
}
