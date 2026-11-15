import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import * as vscode from "vscode";
import {
  createAnthropicProvider,
  createClaudeCliProvider,
  explainHistory,
  explanationCacheDir,
  fileCache,
  isWhyError,
  type AiProvider,
} from "@why/core";
import { lookUpLine } from "./lookup.ts";
import { renderBody, renderPage, type ViewState } from "./render.ts";

const SECRET_KEY = "why.anthropicApiKey";

let panel: vscode.WebviewPanel | undefined;
let view: ViewState | undefined;
let lastRequest: { uri: vscode.Uri; line: number } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("why.showLineHistory", (uri?: vscode.Uri, line?: number) =>
      showLineHistory(context, uri, line),
    ),
    vscode.commands.registerCommand("why.signInToGitHub", async () => {
      if (await githubToken(true)) {
        vscode.window.showInformationMessage("why: signed in to GitHub.");
        if (lastRequest) await showLineHistory(context, lastRequest.uri, lastRequest.line);
      }
    }),
    vscode.commands.registerCommand("why.setAnthropicKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Anthropic API key for AI summaries (stored in the editor's secret storage)",
        password: true,
        ignoreFocusOut: true,
      });
      if (!key?.trim()) return;
      await context.secrets.store(SECRET_KEY, key.trim());
      vscode.window.showInformationMessage("why: Anthropic API key saved.");
    }),
    vscode.commands.registerCommand("why.clearAnthropicKey", async () => {
      await context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage("why: Anthropic API key removed.");
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
}

async function showLineHistory(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const target = uri ?? editor?.document.uri;
  if (!target || target.scheme !== "file") {
    vscode.window.showWarningMessage("why: open a file that is saved on disk first.");
    return;
  }
  const document = await vscode.workspace.openTextDocument(target);
  const lineNumber =
    line ??
    (editor && editor.document.uri.toString() === target.toString()
      ? editor.selection.active.line + 1
      : 1);
  lastRequest = { uri: target, line: lineNumber };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "why: tracing line history" },
    async () => {
      const lookup = await lookUpLine({
        filePath: target.fsPath,
        line: lineNumber,
        text: document.getText(),
        token: await githubToken(false),
      });
      view = {
        lookup,
        fileName: vscode.workspace.asRelativePath(target, false) || basename(target.fsPath),
        lineText: document.lineAt(Math.min(lineNumber, document.lineCount) - 1).text,
        signedIn: Boolean(await githubToken(false)),
      };
      showPanel(context);
    },
  );
}

function showPanel(context: vscode.ExtensionContext): void {
  if (!view) return;
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "why.history",
      "why",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] },
    );
    panel.onDidDispose(() => {
      panel = undefined;
    });
    panel.webview.onDidReceiveMessage((message: { type: string; url?: string }) =>
      onMessage(context, message),
    );
  }
  panel.title = `why: ${basename(view.fileName)}:${view.lookup.editorLine}`;
  panel.webview.html = renderPage(renderBody(view), {
    nonce: randomBytes(16).toString("base64"),
    cspSource: panel.webview.cspSource,
  });
  panel.reveal(undefined, true);
}

async function onMessage(
  context: vscode.ExtensionContext,
  message: { type: string; url?: string },
): Promise<void> {
  if (message.type === "open" && message.url?.startsWith("https://")) {
    await vscode.env.openExternal(vscode.Uri.parse(message.url));
  } else if (message.type === "signIn") {
    await vscode.commands.executeCommand("why.signInToGitHub");
  } else if (message.type === "explain") {
    await explain(context);
  }
}

async function explain(context: vscode.ExtensionContext): Promise<void> {
  if (!view || view.lookup.status !== "found") return;
  const { history } = view.lookup;
  view = { ...view, explanation: { status: "loading" } };
  showPanel(context);

  let provider: AiProvider;
  try {
    provider = await createProvider(context);
  } catch (error) {
    if (!isWhyError(error)) throw error;
    view = { ...view, explanation: { status: "unavailable", reason: error.message, sources: [] } };
    showPanel(context);
    return;
  }

  const result = await explainHistory(history, {
    provider,
    cache: fileCache(explanationCacheDir(process.env)),
  });
  if (view.lookup.status === "found" && view.lookup.history === history) {
    view = { ...view, explanation: result };
    showPanel(context);
  }
}

async function createProvider(context: vscode.ExtensionContext): Promise<AiProvider> {
  const config = vscode.workspace.getConfiguration("why");
  const model = config.get<string>("ai.model")?.trim() || undefined;
  if (config.get<string>("ai.provider") === "anthropic") {
    return createAnthropicProvider({
      apiKey: await context.secrets.get(SECRET_KEY),
      ...(model ? { model } : {}),
    });
  }
  return createClaudeCliProvider({ env: process.env, ...(model ? { model } : {}) });
}

async function githubToken(interactive: boolean): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession(
      "github",
      [],
      interactive ? { createIfNone: true } : { silent: true },
    );
    return session?.accessToken ?? process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  } catch {
    return interactive ? undefined : (process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"]);
  }
}
