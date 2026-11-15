import Link from "next/link";
import { loadIndexes } from "../lib/data.ts";

const REPO_URL = "https://github.com/ZaYnnnnnnn/why";
const EXAMPLE = "/express/lib/response.js/#L72";

const STEPS = [
  {
    title: "Follow the line",
    text: "git log -L traces every commit that changed the line, through renames and edits above it.",
  },
  {
    title: "Catch moves",
    text: "When code was cut from one place and pasted in another, why finds where it came from and keeps going.",
  },
  {
    title: "Find the people",
    text: "Each commit is linked to its pull request, the reviewers' comments on that file and the issues it closed.",
  },
  {
    title: "Show the evidence",
    text: "Every claim links to its source. Where the record is silent, why says so instead of guessing.",
  },
];

export default function Home() {
  const projects = loadIndexes();
  const totalLines = projects.reduce(
    (sum, p) => sum + p.files.reduce((s, f) => s + f.answered, 0),
    0,
  );

  return (
    <main className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <p className="font-mono text-sm text-accent">
          git log, pull requests and issues, joined up
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Ask any line of code why it exists.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          why follows a line back through every commit, file move and rename, then brings in the
          pull requests, review comments and issues behind each change.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={EXAMPLE}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white dark:text-black"
          >
            See why an Express line exists
          </Link>
          <a
            href={REPO_URL}
            className="rounded-md border border-line px-4 py-2.5 text-sm font-medium hover:bg-panel"
          >
            Source on GitHub
          </a>
        </div>
      </section>

      <section aria-labelledby="projects" className="pb-16">
        <h2 id="projects" className="text-sm font-medium uppercase tracking-wide text-muted">
          Explore {totalLines.toLocaleString("en")} traced lines
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.repo}
              href={`/${project.repo}/`}
              className="rounded-lg border border-line bg-panel p-5 transition-colors hover:border-accent"
            >
              <div className="text-lg font-semibold">{project.title}</div>
              <p className="mt-1 text-sm text-muted">{project.description}</p>
              <p className="mt-4 font-mono text-xs text-muted">
                {project.files.length} files ·{" "}
                {project.files.reduce((s, f) => s + f.answered, 0).toLocaleString("en")} lines
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="accuracy" className="border-t border-line py-16">
        <h2 id="accuracy" className="text-2xl font-semibold tracking-tight">
          Measured, not claimed
        </h2>
        <p className="mt-2 max-w-2xl text-muted">
          30 lines picked at random from Express, Flask and React, with the true history of each
          worked out by hand using a different method.
        </p>
        <dl className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            ["20 / 30", "trails end at the true origin"],
            ["30 / 30", "newest step is the last commit that touched the line"],
            ["0 / 30", "trails that follow the wrong line"],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="font-mono text-3xl font-semibold">{value}</dt>
              <dd className="mt-1 text-sm text-muted">{label}</dd>
            </div>
          ))}
        </dl>
        <a
          href={`${REPO_URL}/blob/main/docs/decisions/0007-measuring-accuracy.md`}
          className="mt-6 inline-block text-sm text-accent hover:underline"
        >
          How it was measured, and every miss explained
        </a>
      </section>

      <section aria-labelledby="how" className="border-t border-line py-16">
        <h2 id="how" className="text-2xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <div className="font-mono text-sm text-accent">0{i + 1}</div>
              <div className="mt-1 font-medium">{step.title}</div>
              <p className="mt-1 text-sm text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-line py-8 text-sm text-muted">
        Built by Muhammad Zain · MIT licensed ·{" "}
        <a href={REPO_URL} className="hover:text-fg">
          github.com/ZaYnnnnnnn/why
        </a>
      </footer>
    </main>
  );
}
