import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
  const base = env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(base, "why", "github");
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
        await mkdir(dir, { recursive: true });
        const file = fileFor(key);
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify({ key, ...entry }));
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
