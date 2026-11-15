import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadIndex, loadProjects } from "../../lib/data.ts";
import { shortSha } from "../../lib/format.ts";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadProjects().map((project) => ({ repo: project.repo }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ repo: string }>;
}): Promise<Metadata> {
  const { repo } = await params;
  return { title: loadIndex(repo)?.title ?? repo };
}

export default async function RepoPage({ params }: { params: Promise<{ repo: string }> }) {
  const { repo } = await params;
  const index = loadIndex(repo);
  if (!index) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{index.title}</h1>
      <p className="mt-1 text-muted">{index.description}</p>
      <p className="mt-3 font-mono text-xs text-muted">
        {index.github.owner}/{index.github.repo} at {shortSha(index.commit)}
      </p>

      <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-panel">
        {index.files.map((file) => (
          <li key={file.path}>
            <Link
              href={`/${repo}/${file.path}/`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent-soft"
            >
              <span className="truncate font-mono text-sm">{file.path}</span>
              <span className="shrink-0 font-mono text-xs text-muted">
                {file.answered} of {file.lines} lines traced
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
