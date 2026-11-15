import { codeToTokens, type BundledLanguage } from "shiki";

export interface Token {
  text: string;
  className?: string;
}

export interface Highlighted {
  lines: Token[][];
  css: string;
}

const STYLE_PROPERTY: Record<string, string> = {
  "": "color",
  "font-style": "font-style",
  "font-weight": "font-weight",
  "text-decoration": "text-decoration",
};

export async function highlight(
  source: string,
  lang: BundledLanguage | "text",
): Promise<Highlighted> {
  const { tokens } = await codeToTokens(source, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });

  const classes = new Map<string, string>();
  const lines = tokens.map((line) => {
    const merged: Token[] = [];
    for (const token of line) {
      const style = (token.htmlStyle ?? {}) as Record<string, string>;
      const key = JSON.stringify(Object.entries(style).sort());
      let className = classes.get(key);
      if (className === undefined && Object.keys(style).length > 0) {
        className = `t${classes.size}`;
        classes.set(key, className);
      }
      const last = merged.at(-1);
      if (last && last.className === className) last.text += token.content;
      else merged.push(className ? { text: token.content, className } : { text: token.content });
    }
    return merged;
  });

  const light: string[] = [];
  const dark: string[] = [];
  for (const [key, className] of classes) {
    const style = Object.fromEntries(JSON.parse(key) as Array<[string, string]>);
    light.push(`.code .${className}{${declarations(style, "light")}}`);
    dark.push(`.code .${className}{${declarations(style, "dark")}}`);
  }

  return {
    lines,
    css: `${light.join("")}@media (prefers-color-scheme: dark){${dark.join("")}}`,
  };
}

function declarations(style: Record<string, string>, theme: "light" | "dark"): string {
  return Object.entries(STYLE_PROPERTY)
    .flatMap(([suffix, property]) => {
      const value = style[`--shiki-${theme}${suffix ? `-${suffix}` : ""}`];
      return value ? [`${property}:${value}`] : [];
    })
    .join(";");
}
