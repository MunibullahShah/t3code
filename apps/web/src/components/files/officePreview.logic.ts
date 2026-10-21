/** Enough to read a sheet at a glance without rendering a whole workbook into the DOM. */
export const SPREADSHEET_PREVIEW_MAX_ROWS = 500;
export const SPREADSHEET_PREVIEW_MAX_COLUMNS = 50;

export interface SpreadsheetPreviewSheet {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly truncated: boolean;
}

export function spreadsheetCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    // Dates without a time of day read better without a midnight timestamp.
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(".000Z", "Z");
  }
  return String(value);
}

export function spreadsheetPreviewSheet(
  name: string,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): SpreadsheetPreviewSheet {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = Math.min(width, SPREADSHEET_PREVIEW_MAX_COLUMNS);
  const shown = rows
    .slice(0, SPREADSHEET_PREVIEW_MAX_ROWS)
    .map((row) => Array.from({ length: columns }, (_, index) => spreadsheetCellText(row[index])));
  return {
    name,
    rows: shown,
    truncated:
      rows.length > SPREADSHEET_PREVIEW_MAX_ROWS || width > SPREADSHEET_PREVIEW_MAX_COLUMNS,
  };
}

/**
 * The converted document runs in a frame with no scripts and no network: its
 * only inputs are the HTML below and images Mammoth inlined as data URLs.
 */
export function wordPreviewDocument(bodyHtml: string, theme: "light" | "dark"): string {
  const colors =
    theme === "dark"
      ? "color: #e6e6e6; background: #1b1b1b;"
      : "color: #1b1b1b; background: #ffffff;";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
body { ${colors} font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 52rem; margin: 0 auto; padding: 2rem 1.5rem; color-scheme: ${theme}; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 1rem 0; }
td, th { border: 1px solid currentColor; padding: 0.3rem 0.6rem; vertical-align: top; }
a { color: inherit; }
</style></head><body>${bodyHtml}</body></html>`;
}
