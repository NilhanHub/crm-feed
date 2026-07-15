import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";

// Atomic JSON collection store — real local dev persistence.
// Each collection is a JSON file under data/db/<name>.json containing an
// object keyed by id. Writes are atomic: write to a temp file in the same
// directory, then fs.rename (atomic on the same filesystem). This is NOT a
// mock and NOT in-memory; data survives process restarts.
//
// Concurrency: an in-process per-collection mutex serialises writes so that
// concurrent requests cannot interleave reads-modify-writes and lose data.
// This is sufficient for a single-process local dev server.

const queues = new Map<string, Promise<unknown>>();

function queueFor<T>(name: string, task: () => T | Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const run = (): Promise<T> => Promise.resolve(task());
  const next = prev.then(run, run);
  queues.set(name, next.then(() => undefined, () => undefined));
  return next;
}

function fileFor(name: string): string {
  return path.join(PATHS.db, `${name}.json`);
}

function readRaw<T>(name: string): Record<string, T> {
  const f = fileFor(name);
  try {
    const raw = fs.readFileSync(f, "utf8");
    return JSON.parse(raw) as Record<string, T>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

function writeRawAtomic<T>(name: string, data: Record<string, T>): void {
  const f = fileFor(name);
  const dir = path.dirname(f);
  const tmp = path.join(dir, `.${path.basename(f)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  // fs.rename is atomic on the same filesystem / same volume.
  fs.renameSync(tmp, f);
}

export class Collection<T extends { id: string }> {
  constructor(private readonly name: string) {}

  async set(value: T): Promise<T> {
    return queueFor(this.name, () => {
      const data = readRaw<T>(this.name);
      data[value.id] = value;
      writeRawAtomic(this.name, data);
      return value;
    });
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    return queueFor(this.name, () => {
      const data = readRaw<T>(this.name);
      const existing = data[id];
      if (!existing) return null;
      const updated = { ...existing, ...patch, id } as T;
      data[id] = updated;
      writeRawAtomic(this.name, data);
      return updated;
    });
  }

  async get(id: string): Promise<T | null> {
    const data = readRaw<T>(this.name);
    return data[id] ?? null;
  }

  async all(): Promise<T[]> {
    const data = readRaw<T>(this.name);
    return Object.values(data);
  }

  async remove(id: string): Promise<boolean> {
    return queueFor(this.name, () => {
      const data = readRaw<T>(this.name);
      if (!data[id]) return false;
      delete data[id];
      writeRawAtomic(this.name, data);
      return true;
    });
  }

  // Clears all entries in this collection. Routed through the same per-collection
  // mutex queue as set/update/remove so that a clear cannot race with a pending
  // write from the same process. Used by tests for deterministic isolation.
  async clear(): Promise<void> {
    return queueFor(this.name, () => {
      writeRawAtomic(this.name, {});
    });
  }
}
