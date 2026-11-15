import * as vscode from "vscode";

const KINDS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Interface,
]);

export function registerCodeLens(context: vscode.ExtensionContext): void {
  const changed = new vscode.EventEmitter<void>();

  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changed.event,
    async provideCodeLenses(document) {
      if (document.uri.scheme !== "file") return [];
      if (!vscode.workspace.getConfiguration("why").get<boolean>("codeLens.enabled", true)) {
        return [];
      }
      const symbols = await vscode.commands.executeCommand<
        Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined
      >("vscode.executeDocumentSymbolProvider", document.uri);

      return declarationLines(symbols ?? []).map(
        (line) =>
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: "Why?",
            tooltip: "Show why this line exists: its commits, pull requests and issues",
            command: "why.showLineHistory",
            arguments: [document.uri, line + 1],
          }),
      );
    },
  };

  context.subscriptions.push(
    changed,
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, provider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("why.codeLens.enabled")) changed.fire();
    }),
  );
}

function declarationLines(
  symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>,
): number[] {
  const lines = new Set<number>();
  const visit = (items: Array<vscode.DocumentSymbol | vscode.SymbolInformation>) => {
    for (const symbol of items) {
      if (KINDS.has(symbol.kind)) {
        lines.add(
          "selectionRange" in symbol
            ? symbol.selectionRange.start.line
            : symbol.location.range.start.line,
        );
      }
      if ("children" in symbol) visit(symbol.children);
    }
  };
  visit(symbols);
  return [...lines].sort((a, b) => a - b);
}
