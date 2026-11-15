import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CacheEntry {
  value: unknown;
  storedAt: number;
}

export interface Cache {
  get: (key: string) => Promise<CacheEntry | undefined>;
  set: (key: string, entry: CacheEntry) => Promise<void>;
}

export function defaultCacheDir(env: Record<string, string | undefined>): string {
  return join(cacheRoot(env), "github");
}

export function explanationCacheDir(env: Record<string, string | undefined>): string {
  return join(cacheRoot(env), "explanations");
}

function cacheRoot(env: Record<string, string | undefined>): string {
  return join(env["XDG_CACHE_HOME"] || join(homedir(), ".cache"), "why");
}

export function fileCache(dir: string): Cache {
  const fileFor = (key: string) =>
    join(dir, `${createHash("sha256").update(key).digest("hex").slice(0, 40)}.json`);

  return {
    async get(key) {
      try {
        const stored = JSON.parse(await readFile(fileFor(key), "utf8")) as CacheEntry & {
          key: string;
        };
        return stored.key === key ? { value: stored.value, storedAt: stored.storedAt } : undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, entry) {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
        const file = fileFor(key);
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify({ key, ...entry }), { mode: 0o600 });
        await rename(temp, file);
      } catch {
        return;
      }
    },
  };
}

export function memoryCache(): Cache {
  const entries = new Map<string, CacheEntry>();
  return {
    get: async (key) => entries.get(key),
    set: async (key, entry) => {
      entries.set(key, entry);
    },
  };
}
