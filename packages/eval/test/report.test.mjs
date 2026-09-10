import assert from "node:assert/strict";
import { test } from "node:test";
import { linksUnderHeading } from "../lib/report.mjs";

test("linksUnderHeading_returnsLinksInOrderUnderTheNamedHeading", () => {
  const body = [
    "Some preamble.",
    "",
    "## Read these",
    "1. [Architecture](notes/architecture-overview.md)",
    "2. [Retry policy](plans/retry-policy-design.md)",
    "",
    "## Next",
    "- do something else",
  ].join("\n");
  const links = linksUnderHeading(body, "Read these");
  assert.deepEqual(links, [
    { title: "Architecture", href: "notes/architecture-overview.md" },
    { title: "Retry policy", href: "plans/retry-policy-design.md" },
  ]);
});

test("linksUnderHeading_returnsEmpty_whenHeadingIsMissing", () => {
  assert.deepEqual(linksUnderHeading("no headings here", "Read these"), []);
});

test("linksUnderHeading_returnsEmpty_whenBodyIsNullOrUndefined", () => {
  assert.deepEqual(linksUnderHeading(null, "Read these"), []);
  assert.deepEqual(linksUnderHeading(undefined, "Read these"), []);
});

test("linksUnderHeading_stopsAtTheNextHeading_evenWithNoTrailingBlankLine", () => {
  const body = "## Read these\n[A](a.md)\n## Next\n[B](b.md)";
  assert.deepEqual(linksUnderHeading(body, "Read these"), [{ title: "A", href: "a.md" }]);
});

test("linksUnderHeading_ignoresLinksInAnUnrelatedHeading", () => {
  const body = "## Other\n[A](a.md)\n\n## Read these\n[B](b.md)";
  assert.deepEqual(linksUnderHeading(body, "Read these"), [{ title: "B", href: "b.md" }]);
});
