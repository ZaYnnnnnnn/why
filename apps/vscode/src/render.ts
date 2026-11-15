import type {
  ChangeEvidence,
  EvidenceSource,
  ExplainResult,
  GitHubRepo,
  IssueEvidence,
  LineChange,
  LinkedHistory,
} from "@why/core";
import type { Lookup } from "./lookup.ts";

export type ExplainState = { status: "loading" } | ExplainResult;

export interface ViewState {
  lookup: Lookup;
  fileName: string;
  lineText: string;
  signedIn: boolean;
  explanation?: ExplainState;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;

export function renderBody(state: ViewState): string {
  const { lookup } = state;
  const header = `<header>
  <p class="muted mono">${e(state.fileName)}:${lookup.editorLine}</p>
  <p class="mono line">${e(state.lineText.trim())}</p>
</header>`;

  if (lookup.status === "uncommitted") {
    return `${header}<p class="note">${
      lookup.reason === "added"
        ? "Not committed yet. This line was added since the last commit, so it has no history."
        : "This line has changes that are not committed yet. Commit them, or undo them, to see the line's history."
    }</p>`;
  }
  if (lookup.status === "untracked") {
    return `${header}<p class="note">This file is not in git yet, so it has no history.</p>`;
  }
  if (lookup.status === "failed") {
    return `${header}<p class="note error">${e(lookup.message)}</p>`;
  }

  const { history } = lookup;
  const github = "github" in history ? history.github : undefined;
  const parts = [header];

  parts.push(renderExplanation(state.explanation, github));

  if (github && !state.signedIn) {
    parts.push(
      `<p class="muted small">GitHub allows 60 lookups an hour without signing in. <a href="#" data-action="signIn">Sign in to GitHub</a> for 5,000.</p>`,
    );
  }
  for (const warning of lookup.warnings) parts.push(`<p class="note error">${e(warning)}</p>`);

  const count = history.changes.length;
  parts.push(`<p class="muted small">${count} change${count === 1 ? "" : "s"}, newest first</p>`);
  parts.push(
    `<ol class="steps">${history.changes.map((c) => renderStep(c, history.path, github)).join("")}</ol>`,
  );
  return parts.join("\n");
}

function renderExplanation(
  state: ExplainState | undefined,
  github: GitHubRepo | undefined,
): string {
  if (!state) {
    return `<p><button data-action="explain">Explain with AI</button></p>`;
  }
  if (state.status === "loading") return `<p class="muted">Asking the AI…</p>`;
  if (state.status === "unavailable") {
    return `<p class="note error">AI summary unavailable: ${e(state.reason)}</p><p><button data-action="explain">Try again</button></p>`;
  }

  const labels = new Map(state.sources.map((s) => [s.id, citeLabel(s, github)]));
  const cite = (ids: string[]) =>
    `<span class="muted">(${e([...new Set(ids.map((id) => labels.get(id) ?? id))].join(", "))})</span>`;
  const readable = (text: string) =>
    text.replace(/\b(?:C|PR|R|I)\d+\b/g, (id) => labels.get(id) ?? id);
  const { explanation } = state;

  return `<section class="why">
  <h2>Why</h2>
  <p>${e(readable(explanation.summary))} ${cite(explanation.summaryCites)}</p>
  <ul>${explanation.timeline.map((t) => `<li>${e(readable(t.text))} ${cite(t.cites)}</li>`).join("")}</ul>
  <p class="muted small">Confidence: ${e(explanation.confidence)}</p>
  ${explanation.gaps.map((g) => `<p class="muted small">Not in the evidence: ${e(readable(g))}</p>`).join("")}
  <p class="muted small">Explained by ${e(state.provider)}${state.model === "default" ? "" : ` ${e(state.model)}`}${state.cached ? " (cached)" : ""}</p>
</section>`;
}

function renderStep(
  change: LineChange,
  currentPath: string,
  github: GitHubRepo | undefined,
): string {
  const sha = change.commit.slice(0, 7);
  const shaHtml = github
    ? link(`https://github.com/${github.owner}/${github.repo}/commit/${change.commit}`, sha, "sha")
    : `<span class="sha">${sha}</span>`;
  const unchangedMove = change.kind === "moved" && change.before.join() === change.after.join();
  const diff = unchangedMove
    ? ""
    : `<pre class="diff">${change.before.map((t) => `<span class="del">- ${e(t)}</span>`).join("\n")}${
        change.before.length && change.after.length ? "\n" : ""
      }${change.after.map((t) => `<span class="add">+ ${e(t)}</span>`).join("\n")}</pre>`;
  const origins = change.possibleOrigins
    ? `<p class="muted small">May have been moved from ${e(change.possibleOrigins.map((o) => `${o.path}:${o.lineNumber}`).join(" or "))}</p>`
    : "";
  const evidence =
    "evidence" in change && github
      ? renderEvidence((change as LinkedHistory["changes"][number]).evidence, github)
      : "";

  return `<li>
  <p class="meta">${shaHtml} <span class="muted">${e(change.date.slice(0, 10))} ${e(change.authorName)}</span></p>
  <p class="subject">${e(change.subject)}</p>
  <p class="muted small">${e(describe(change, currentPath))}</p>
  ${diff}${origins}${evidence}
</li>`;
}

function renderEvidence(evidence: ChangeEvidence, github: GitHubRepo): string {
  const parts: string[] = [];
  const pr = evidence.pullRequest;
  if (pr) {
    const when = pr.mergedAt ? `Merged ${pr.mergedAt.slice(0, 10)}` : pr.state;
    const batch = pr.batch ? ` · a release batch of ${pr.commitCount} commits` : "";
    parts.push(`<div class="pr">
  <p>${link(pr.url, `PR #${pr.number}`, "accent")} ${e(pr.title)}</p>
  <p class="muted small">${e(when)} by @${e(pr.author)}${e(batch)}</p>
  ${pr.reviewComments
    .map(
      (r) =>
        `<blockquote>${link(r.url, `@${r.author}`)} <span class="muted">on this file:</span> ${e(firstLine(r.body))}</blockquote>`,
    )
    .join("")}
</div>`);
  }
  for (const issue of evidence.issues) {
    parts.push(
      `<p class="issue"><span class="muted small">${e(issue.link)}</span> ${link(issue.url, issueLabel(issue, github), "accent")} ${e(issue.title)} <span class="muted small">(${e(issue.state)})</span></p>`,
    );
  }
  return parts.join("");
}

export function renderPage(
  body: string,
  { nonce, cspSource }: { nonce: string; cspSource: string },
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 12px 24px; line-height: 1.45; }
  .mono, pre { font-family: var(--vscode-editor-font-family); }
  .muted { color: var(--vscode-descriptionForeground); }
  .small { font-size: 0.9em; }
  .line { white-space: pre-wrap; word-break: break-word; }
  header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; margin-bottom: 8px; }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .accent, .sha { font-family: var(--vscode-editor-font-family); }
  .steps { list-style: none; padding: 0; margin: 0; }
  .steps > li { border-left: 2px solid var(--vscode-panel-border); padding: 2px 0 2px 10px; margin: 0 0 16px; }
  .meta, .subject { margin: 0; }
  .subject { font-weight: 600; margin-top: 2px; }
  .steps p { margin: 2px 0; }
  .diff { background: var(--vscode-textCodeBlock-background); padding: 6px 8px; overflow-x: auto; margin: 6px 0; }
  .del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .add { color: var(--vscode-gitDecoration-addedResourceForeground); }
  .pr { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 8px; margin-top: 8px; }
  blockquote { margin: 6px 0 0; padding-left: 8px; border-left: 2px solid var(--vscode-textLink-foreground); }
  .note { padding: 8px; border-radius: 4px; background: var(--vscode-textBlockQuote-background); }
  .error { color: var(--vscode-errorForeground); }
  .why { border: 1px solid var(--vscode-focusBorder); border-radius: 4px; padding: 4px 10px; margin: 8px 0 12px; }
  .why h2 { font-size: 1em; margin: 6px 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
${body}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action], a[data-href]");
    if (!target) return;
    event.preventDefault();
    if (target.dataset.href) vscode.postMessage({ type: "open", url: target.dataset.href });
    else vscode.postMessage({ type: target.dataset.action });
  });
</script>
</body>
</html>`;
}

function link(url: string, text: string, className = ""): string {
  return `<a href="#" data-href="${e(url)}"${className ? ` class="${className}"` : ""}>${e(text)}</a>`;
}

function describe(change: LineChange, currentPath: string): string {
  const where = `line ${change.lineNumber}${change.path && change.path !== currentPath ? ` in ${change.path}` : ""}`;
  if (change.kind === "moved" && change.movedFrom) {
    return `Moved to ${where} from ${change.movedFrom.path}:${change.movedFrom.lineNumber}`;
  }
  return `${change.kind === "added" ? "Added at" : "Changed at"} ${where}`;
}

function issueLabel(issue: IssueEvidence, github: GitHubRepo): string {
  const same =
    issue.owner.toLowerCase() === github.owner.toLowerCase() &&
    issue.repo.toLowerCase() === github.repo.toLowerCase();
  return `${issue.isPullRequest ? "PR " : ""}${same ? "" : `${issue.owner}/${issue.repo}`}#${issue.number}`;
}

function citeLabel(source: EvidenceSource, github: GitHubRepo | undefined): string {
  if (source.kind !== "issue" || !github) return source.label;
  const prefix = `${github.owner}/${github.repo}#`;
  const at = source.label.toLowerCase().indexOf(prefix.toLowerCase());
  return at === -1
    ? source.label
    : `${source.label.slice(0, at)}#${source.label.slice(at + prefix.length)}`;
}

function firstLine(text: string, max = 240): string {
  const line =
    text
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
