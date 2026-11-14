import { styleText } from "node:util";
import type { LineChange, LineHistory } from "@why/core";

type Style = Parameters<typeof styleText>[0];

export interface FormatOptions {
  color: boolean;
}

export function formatHistory(history: LineHistory, options: FormatOptions): string {
  const paint = (style: Style, text: string) =>
    options.color ? styleText(style, text, { validateStream: false }) : text;

  const location = `${history.path}:${history.line}`;
  const lines = [
    paint("bold", history.rev === "HEAD" ? location : `${location} at ${history.rev}`),
    `  ${history.content}`,
    "",
  ];

  const count = history.changes.length;
  if (count === 0) {
    lines.push(paint("dim", "No commits found for this line."), "");
    return lines.join("\n");
  }
  lines.push(paint("dim", `${count} change${count === 1 ? "" : "s"}, newest first`), "");

  for (const change of history.changes) {
    lines.push(
      `${paint("yellow", change.commit.slice(0, 7))}  ${change.date.slice(0, 10)}  ${change.authorName}`,
      `  ${paint("bold", change.subject)}`,
      paint("dim", `  ${describe(change, history.path)}`),
    );

    const unchangedMove = change.kind === "moved" && change.before.join() === change.after.join();
    if (!unchangedMove) {
      lines.push(
        ...change.before.map((text) => paint("red", `  - ${text}`)),
        ...change.after.map((text) => paint("green", `  + ${text}`)),
      );
    }

    if (change.possibleOrigins) {
      const places = change.possibleOrigins.map((o) => `${o.path}:${o.lineNumber}`).join(" or ");
      lines.push(paint("dim", `  may have been moved from ${places}`));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function describe(change: LineChange, currentPath: string): string {
  const where = `line ${change.lineNumber}${change.path && change.path !== currentPath ? ` in ${change.path}` : ""}`;
  if (change.kind === "moved" && change.movedFrom) {
    return `moved to ${where} from ${change.movedFrom.path}:${change.movedFrom.lineNumber}`;
  }
  return `${change.kind === "added" ? "added" : "changed"} at ${where}`;
}
