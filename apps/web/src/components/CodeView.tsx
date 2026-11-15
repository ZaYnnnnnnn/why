"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { parseLineHash } from "../lib/format.ts";
import type { DemoRepoIndex } from "../lib/types.ts";
import { TimelinePanel } from "./TimelinePanel.tsx";

interface Props {
  repo: string;
  path: string;
  github: DemoRepoIndex["github"];
  children: ReactNode;
}

export function CodeView({ repo, path, github, children }: Props) {
  const codeRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | undefined>();

  const lineElement = useCallback(
    (line: number) => codeRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`),
    [],
  );

  const select = useCallback(
    (line: number | undefined, { scroll = false } = {}) => {
      if (line !== undefined && !lineElement(line)?.hasAttribute("data-answered")) return;
      setSelected(line);
      const url = `${window.location.pathname}${window.location.search}${line ? `#L${line}` : ""}`;
      window.history.replaceState(null, "", url);

      const element = line ? lineElement(line) : undefined;
      if (!element) return;
      if (!window.matchMedia("(min-width: 64rem)").matches) {
        const top = element.getBoundingClientRect().top + window.scrollY - 72;
        window.scrollTo({ top, behavior: scroll ? "auto" : "smooth" });
      } else if (scroll) {
        element.scrollIntoView({ block: "center" });
      }
    },
    [lineElement],
  );

  useEffect(() => {
    const fromHash = () => {
      const line = parseLineHash(window.location.hash);
      if (line) select(line, { scroll: true });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [select]);

  useEffect(() => {
    const code = codeRef.current;
    if (!code) return;
    code.querySelector("[data-selected]")?.removeAttribute("data-selected");
    if (selected) lineElement(selected)?.setAttribute("data-selected", "");
  }, [selected, lineElement]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(undefined);
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const lines = [...(codeRef.current?.querySelectorAll<HTMLElement>("[data-answered]") ?? [])];
      const index = lines.findIndex((el) => Number(el.dataset["line"]) === selected);
      const next = lines[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        select(Number(next.dataset["line"]));
        next.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, select]);

  const onClick = (event: React.MouseEvent) => {
    const line = (event.target as HTMLElement).closest<HTMLElement>("[data-answered]");
    if (line) select(Number(line.dataset["line"]));
  };

  return (
    <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-4">
      <div
        ref={codeRef}
        onClick={onClick}
        className="code overflow-x-auto rounded-lg border border-line bg-panel py-2 font-mono text-[13px]"
      >
        {children}
      </div>

      {selected ? (
        <TimelinePanel
          key={selected}
          repo={repo}
          path={path}
          line={selected}
          github={github}
          onClose={() => select(undefined)}
        />
      ) : (
        <aside className="hidden lg:block">
          <div className="sticky top-4 rounded-lg border border-dashed border-line p-6 text-sm text-muted">
            Pick a marked line to see every commit that shaped it, the pull requests behind those
            commits, what reviewers said and the issues they closed.
            <p className="mt-3 text-xs">Tip: use the arrow keys to step through lines.</p>
          </div>
        </aside>
      )}
    </div>
  );
}
