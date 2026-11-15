import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeView } from "../../../components/CodeView.tsx";
import { loadFile, loadIndex, loadProjects } from "../../../lib/data.ts";
import { fileUrl, languageFor, shortSha } from "../../../lib/format.ts";
import { highlight } from "../../../lib/highlight.ts";

export const dynamicParams = false;

type Params = Promise<{ repo: string; path: string[] }>;

export function generateStaticParams() {
  return loadProjects().flatMap((project) =>
    project.files.map((file) => ({ repo: project.repo, path: file.split("/") })),
  );
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { repo, path } = await params;
  return { title: `${path.join("/")} (${loadIndex(repo)?.title ?? repo})` };
}

export default async function FilePage({ params }: { params: Params }) {
  const { repo, path: parts } = await params;
  const path = parts.join("/");
  const index = loadIndex(repo);
  const file = loadFile(repo, path);
  if (!index || !file) notFound();

  const { lines, css } = await highlight(file.source, languageFor(path));
  const answered = new Set(Object.keys(file.answers).map(Number));

  return (
    <main className="mx-auto max-w-[96rem] px-4 py-6">
      <style>{css}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <nav className="font-mono text-sm">
          <Link href={`/${repo}/`} className="text-muted hover:text-fg">
            {index.title}
          </Link>
          <span className="text-muted"> / </span>
          <span>{path}</span>
        </nav>
        <a
          href={fileUrl(index.github, index.commit, path)}
          className="font-mono text-xs text-muted hover:text-fg"
        >
          {shortSha(index.commit)} on GitHub
        </a>
      </div>
      <p className="mt-2 text-sm text-muted">
        Click a marked line to see why it exists. {answered.size} of {lines.length} lines are
        traced.
      </p>

      <CodeView repo={repo} path={path} github={index.github}>
        {lines.map((line, i) => {
          const number = i + 1;
          return (
            <div
              key={number}
              className="line"
              data-line={number}
              {...(answered.has(number) ? { "data-answered": "" } : {})}
            >
              <span className="num">{number}</span>
              <span className="dot" />
              <span className="text">
                {line.map((token, j) =>
                  token.className ? (
                    <span key={j} className={token.className}>
                      {token.text}
                    </span>
                  ) : (
                    token.text
                  ),
                )}
              </span>
            </div>
          );
        })}
      </CodeView>
    </main>
  );
}
