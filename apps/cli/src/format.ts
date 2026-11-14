import { styleText } from "node:util";
import type { LineHistory } from "@why/core";

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
    const verb = change.kind === "added" ? "added" : "changed";
    const elsewhere = change.path && change.path !== history.path ? ` in ${change.path}` : "";

    lines.push(
      `${paint("yellow", change.commit.slice(0, 7))}  ${change.date.slice(0, 10)}  ${change.authorName}`,
      `  ${paint("bold", change.subject)}`,
      paint("dim", `  ${verb} at line ${change.lineNumber}${elsewhere}`),
      ...change.before.map((text) => paint("red", `  - ${text}`)),
      ...change.after.map((text) => paint("green", `  + ${text}`)),
      "",
    );
  }

  return lines.join("\n");
}
