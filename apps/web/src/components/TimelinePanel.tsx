"use client";

import { useEffect, useState } from "react";
import {
  commitUrl,
  dataUrl,
  describeStep,
  firstLine,
  formatDate,
  issueLabel,
  shortSha,
} from "../lib/format.ts";
import type { DemoFile, DemoRepoIndex, DemoSources, DemoStep } from "../lib/types.ts";

interface Props {
  repo: string;
  path: string;
  line: number;
  github: DemoRepoIndex["github"];
  onClose: () => void;
}

const cache = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${url}`);
      return response.json();
    });
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending as Promise<T>;
}

export function TimelinePanel({ repo, path, line, github, onClose }: Props) {
  const [data, setData] = useState<{ file: DemoFile; sources: DemoSources } | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    Promise.all([
      load<DemoFile>(dataUrl(`${repo}/files/${path}.json`)),
      load<DemoSources>(dataUrl(`${repo}/sources.json`)),
    ])
      .then(([file, sources]) => live && setData({ file, sources }))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [repo, path]);

  const answer = data?.file.answers[String(line)];
  const text = data?.file.source.split("\n")[line - 1]?.trim();

  return (
    <aside
      aria-label={`History of line ${line}`}
      className="fixed inset-x-0 bottom-0 z-20 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-panel p-4 shadow-2xl lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-lg lg:border lg:shadow-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">Line {line}</p>
          {text ? <p className="mt-1 truncate font-mono text-sm">{text}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-fg"
          aria-label="Close"
        >
          Close
        </button>
      </div>

      {error ? <p className="mt-6 text-sm text-removed">{error}</p> : null}
      {!data && !error ? <p className="mt-6 text-sm text-muted">Loading history…</p> : null}
      {data && !answer ? (
        <p className="mt-6 text-sm text-muted">This line has no traced history.</p>
      ) : null}

      {data && answer ? (
        <>
          <p className="mt-4 text-xs text-muted">
            {answer.steps.length} change{answer.steps.length === 1 ? "" : "s"}, newest first
          </p>
          <ol className="mt-3 space-y-5">
            {answer.steps.map((step) => (
              <Step
                key={`${step.commit}-${step.lineNumber}`}
                step={step}
                path={path}
                sources={data.sources}
                github={github}
              />
            ))}
          </ol>
        </>
      ) : null}
    </aside>
  );
}

function Step({
  step,
  path,
  sources,
  github,
}: {
  step: DemoStep;
  path: string;
  sources: DemoSources;
  github: DemoRepoIndex["github"];
}) {
  const commit = sources.commits[step.commit];
  const pr =
    step.pullRequest === undefined ? undefined : sources.pullRequests[String(step.pullRequest)];
  const unchangedMove = step.kind === "moved" && step.before.join() === step.after.join();

  return (
    <li className="border-l-2 border-line pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
        <a href={commitUrl(github, step.commit)} className="font-mono text-accent hover:underline">
          {shortSha(step.commit)}
        </a>
        {commit ? (
          <>
            <span>{formatDate(commit.date)}</span>
            <span>{commit.author}</span>
          </>
        ) : null}
      </div>
      {commit ? <p className="mt-1 text-sm font-medium">{commit.subject}</p> : null}
      <p className="mt-0.5 text-xs text-muted">{describeStep(step, path)}</p>

      {!unchangedMove && (step.before.length > 0 || step.after.length > 0) ? (
        <pre className="mt-2 overflow-x-auto rounded bg-bg p-2 font-mono text-[12px] leading-5">
          {step.before.map((t, i) => (
            <div key={`b${i}`} className="text-removed">
              - {t}
            </div>
          ))}
          {step.after.map((t, i) => (
            <div key={`a${i}`} className="text-added">
              + {t}
            </div>
          ))}
        </pre>
      ) : null}

      {step.possibleOrigins ? (
        <p className="mt-2 text-xs text-muted">
          May have been moved from{" "}
          {step.possibleOrigins.map((o) => `${o.path}:${o.lineNumber}`).join(" or ")}
        </p>
      ) : null}

      {commit?.body ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Commit message</summary>
          <p className="mt-1 whitespace-pre-wrap text-muted">{commit.body}</p>
        </details>
      ) : null}

      {pr ? (
        <div className="mt-3 rounded-md border border-line p-2.5">
          <a href={pr.url} className="text-sm font-medium hover:underline">
            <span className="font-mono text-accent">PR #{pr.number}</span> {pr.title}
          </a>
          <p className="mt-0.5 text-xs text-muted">
            {pr.mergedAt ? `Merged ${formatDate(pr.mergedAt)}` : pr.state} by @{pr.author}
            {pr.batch ? ` · a release batch of ${pr.commitCount} commits` : ""}
          </p>
          {pr.body && !pr.batch ? (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-muted">Description</summary>
              <p className="mt-1 whitespace-pre-wrap text-muted">{pr.body}</p>
            </details>
          ) : null}
          {step.reviews?.map((review) => (
            <blockquote key={review.url} className="mt-2 border-l-2 border-accent pl-2 text-xs">
              <a href={review.url} className="font-medium hover:underline">
                @{review.author}
              </a>
              <span className="text-muted"> on this file: </span>
              {firstLine(review.body, 240)}
            </blockquote>
          ))}
        </div>
      ) : null}

      {step.issues?.map(({ key, link }) => {
        const issue = sources.issues[key];
        if (!issue) return null;
        return (
          <a key={key} href={issue.url} className="mt-2 block text-sm hover:underline">
            <span className="text-xs text-muted">{link} </span>
            <span className="font-mono text-accent">{issueLabel(issue, github)}</span> {issue.title}
            <span className="text-xs text-muted"> ({issue.state})</span>
          </a>
        );
      })}
    </li>
  );
}
