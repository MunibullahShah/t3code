import { describe, expect, it } from "@effect/vitest";

import {
  SPREADSHEET_PREVIEW_MAX_COLUMNS,
  SPREADSHEET_PREVIEW_MAX_ROWS,
  spreadsheetCellText,
  spreadsheetPreviewSheet,
  wordPreviewDocument,
} from "./officePreview.logic";

describe("spreadsheetCellText", () => {
  it("shows dates, numbers and booleans as a reader expects", () => {
    expect(spreadsheetCellText(new Date("2026-10-21T00:00:00.000Z"))).toBe("2026-10-21");
    expect(spreadsheetCellText(new Date("2026-10-21T14:30:00.000Z"))).toBe("2026-10-21T14:30:00Z");
    expect(spreadsheetCellText(1234.5)).toBe("1234.5");
    expect(spreadsheetCellText(false)).toBe("false");
    expect(spreadsheetCellText(null)).toBe("");
  });
});

describe("spreadsheetPreviewSheet", () => {
  it("pads ragged rows to the widest row", () => {
    const sheet = spreadsheetPreviewSheet("Budget", [
      ["Item", "Cost", "Notes"],
      ["Rent", 900],
    ]);
    expect(sheet.rows).toEqual([
      ["Item", "Cost", "Notes"],
      ["Rent", "900", ""],
    ]);
    expect(sheet.truncated).toBe(false);
  });

  it("caps rows and columns and says so", () => {
    const wide = Array.from({ length: SPREADSHEET_PREVIEW_MAX_COLUMNS + 5 }, (_, index) => index);
    const rows = Array.from({ length: SPREADSHEET_PREVIEW_MAX_ROWS + 10 }, () => wide);
    const sheet = spreadsheetPreviewSheet("Big", rows);
    expect(sheet.rows).toHaveLength(SPREADSHEET_PREVIEW_MAX_ROWS);
    expect(sheet.rows[0]).toHaveLength(SPREADSHEET_PREVIEW_MAX_COLUMNS);
    expect(sheet.truncated).toBe(true);
  });
});

describe("wordPreviewDocument", () => {
  it("blocks scripts and network in the converted page", () => {
    const page = wordPreviewDocument("<p>Hello</p>", "dark");
    expect(page).toContain("default-src 'none'");
    expect(page).toContain("img-src data:");
    expect(page).toContain("<body><p>Hello</p></body>");
    expect(page).toContain("color-scheme: dark");
  });
});
