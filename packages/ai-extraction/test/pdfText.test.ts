import { describe, expect, it } from "vitest";
import { tableToMarkdown } from "../src/pdfText.js";

describe("tableToMarkdown", () => {
  it("renders a detected table as a Markdown table with a header separator", () => {
    const rows = [
      ["Item", "Qty", "Unit Price", "Subtotal"],
      ["Widgets", "10", "45.00", "450.00"],
      ["Installation", "1", "200.00", "200.00"],
    ];

    expect(tableToMarkdown(rows)).toBe(
      [
        "| Item | Qty | Unit Price | Subtotal |",
        "| --- | --- | --- | --- |",
        "| Widgets | 10 | 45.00 | 450.00 |",
        "| Installation | 1 | 200.00 | 200.00 |",
      ].join("\n"),
    );
  });

  it("escapes a literal pipe inside a cell so it can't be mistaken for a column break", () => {
    expect(tableToMarkdown([["A|B", "C"]])).toBe("| A\\|B | C |\n| --- | --- |");
  });

  it("collapses embedded newlines within a cell onto one line", () => {
    expect(tableToMarkdown([["Line one\nLine two", "C"]])).toBe("| Line one Line two | C |\n| --- | --- |");
  });

  it("returns an empty string for a table with no rows", () => {
    expect(tableToMarkdown([])).toBe("");
  });
});
