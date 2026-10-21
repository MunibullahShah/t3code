/* oxlint-disable react/no-array-index-key -- Table rows and columns have stable positions and may contain identical values. */
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { WorkspaceOfficePreviewKind } from "@t3tools/shared/filePreview";
import { useEffect, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

import { FileSurfaceFailure, FileSurfaceLoading, FileSurfaceNotice } from "./fileSurfaceChrome";
import { workspaceAssetResource } from "./filePreviewMode";
import {
  SPREADSHEET_PREVIEW_MAX_COLUMNS,
  SPREADSHEET_PREVIEW_MAX_ROWS,
  type SpreadsheetPreviewSheet,
  spreadsheetPreviewSheet,
  wordPreviewDocument,
} from "./officePreview.logic";

type OfficePreview =
  | { readonly kind: "spreadsheet"; readonly sheets: ReadonlyArray<SpreadsheetPreviewSheet> }
  | { readonly kind: "word"; readonly html: string };

type OfficePreviewState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly preview: OfficePreview };

// The readers load only when someone opens a workbook or document.
async function readOfficePreview(
  kind: WorkspaceOfficePreviewKind,
  bytes: ArrayBuffer,
): Promise<OfficePreview> {
  if (kind === "spreadsheet") {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(bytes);
    return {
      kind,
      sheets: sheets.map((sheet) => spreadsheetPreviewSheet(sheet.sheet, sheet.data)),
    };
  }
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return { kind, html: result.value };
}

export function WorkspaceOfficePreview(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly absolutePath: string;
  readonly workspaceRoot: string;
  readonly name: string;
  readonly kind: WorkspaceOfficePreviewKind;
  readonly workspaceMutationId: string | null;
}) {
  const resource = workspaceAssetResource({
    kind: "workspace-file",
    threadRef: props.threadRef,
    draft: props.draft,
    workspaceRoot: props.workspaceRoot,
    absolutePath: props.absolutePath,
  });
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const [state, setState] = useState<OfficePreviewState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const url = assetUrl._tag === "Success" ? assetUrl.url : null;

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- A new file or revision clears the previous preview before loading.
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: "reload" });
        if (!response.ok) throw new Error(`The file could not be loaded (${response.status}).`);
        const preview = await readOfficePreview(props.kind, await response.arrayBuffer());
        if (!controller.signal.aborted) setState({ status: "ready", preview });
      } catch (cause: unknown) {
        if (controller.signal.aborted) return;
        setState({
          status: "failed",
          message:
            cause instanceof Error && cause.message.length > 0
              ? `Unable to show this file: ${cause.message}`
              : "Unable to show this file.",
        });
      }
    })();
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- An edit to the file or a retry reloads it from the same URL.
  }, [url, props.kind, props.workspaceMutationId, retry]);

  if (assetUrl._tag === "Failure") {
    return <FileSurfaceFailure message="Unable to load file preview." />;
  }
  if (state.status === "failed") {
    return (
      <FileSurfaceFailure message={state.message} onRetry={() => setRetry((value) => value + 1)} />
    );
  }
  if (state.status === "loading" || url === null) return <FileSurfaceLoading />;
  return state.preview.kind === "spreadsheet" ? (
    <SpreadsheetPreview name={props.name} sheets={state.preview.sheets} />
  ) : (
    <WordPreview name={props.name} html={state.preview.html} />
  );
}

function WordPreview(props: { readonly name: string; readonly html: string }) {
  const { resolvedTheme } = useTheme();
  return (
    <iframe
      title={props.name}
      // No scripts, forms or same-origin access: the page can only be read.
      sandbox=""
      srcDoc={wordPreviewDocument(props.html, resolvedTheme === "dark" ? "dark" : "light")}
      className="min-h-0 w-full flex-1 border-0"
    />
  );
}

function SpreadsheetPreview(props: {
  readonly name: string;
  readonly sheets: ReadonlyArray<SpreadsheetPreviewSheet>;
}) {
  const [selected, setSelected] = useState(0);
  const sheet = props.sheets[Math.min(selected, props.sheets.length - 1)];
  if (sheet === undefined) {
    return <FileSurfaceFailure message="This workbook has no sheets." />;
  }
  const [header, ...body] = sheet.rows;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.sheets.length > 1 ? (
        <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1">
          {props.sheets.map((candidate, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={candidate === sheet}
              className={cn(
                "shrink-0 rounded px-2 py-0.5 text-xs",
                candidate === sheet
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
              onClick={() => setSelected(index)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      ) : null}
      {sheet.truncated ? (
        <FileSurfaceNotice>
          Showing the first {SPREADSHEET_PREVIEW_MAX_ROWS} rows and{" "}
          {SPREADSHEET_PREVIEW_MAX_COLUMNS} columns of this sheet.
        </FileSurfaceNotice>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="min-w-full border-separate border-spacing-0 text-xs"
          aria-label={`${props.name}: ${sheet.name}`}
        >
          {header ? (
            <thead className="sticky top-0 z-10">
              <tr>
                {header.map((cell, columnIndex) => (
                  <th
                    key={columnIndex}
                    scope="col"
                    className="max-w-80 border-b border-border bg-muted/60 px-3 py-1.5 text-left align-bottom font-medium whitespace-pre-wrap break-words backdrop-blur"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td
                    key={columnIndex}
                    className="max-w-80 border-b border-border/60 px-3 py-1 align-top whitespace-pre-wrap break-words"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
