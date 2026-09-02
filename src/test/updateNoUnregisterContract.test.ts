import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * WO-145D — source-level contract.
 *
 * Ordinary update activation must never unregister the production service
 * worker: that removes offline availability for every client of the shared
 * registration. `unregister()` is permitted in exactly one place — the guarded
 * registrar, behind the explicit `?sw=off` diagnostic / dev+preview refusal path.
 */
const SRC = resolve(process.cwd(), "src");
const ALLOWED = new Set(["src/lib/registerServiceWorker.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((full) => ({
  rel: full.slice(resolve(process.cwd()).length + 1).replace(/\\/g, "/"),
  text: readFileSync(full, "utf8"),
}));

describe("service-worker unregister contract", () => {
  it("only the guarded registrar may call unregister()", () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .filter(({ text }) => /\.unregister\s*\(/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("keeps unregister behind the explicit ?sw=off / non-production path", () => {
    const registrar = readFileSync(
      resolve(process.cwd(), "src/lib/registerServiceWorker.ts"),
      "utf8",
    );
    expect(registrar).toContain('"sw") === "off"');
    expect(registrar).toContain("import.meta.env.PROD");
    // The only unregister call site sits inside the refusal branch.
    expect(registrar.match(/\.unregister\(/g) ?? []).toHaveLength(1);
  });

  it("the update coordinator and its React binding contain no release fallback", () => {
    for (const rel of ["src/lib/pwaUpdate.ts", "src/hooks/usePwaUpdate.tsx"]) {
      const text = readFileSync(resolve(process.cwd(), rel), "utf8");
      expect(text).not.toMatch(/\.unregister\s*\(/);
      expect(text).not.toMatch(/releaseRegistration/);
      expect(text).not.toMatch(/allowRecoveryReload/);
    }
  });

  it("has no leftover activation-recovery module endorsing unregister", () => {
    const stale = files.filter(({ rel }) => rel.includes("activationRecovery"));
    expect(stale).toEqual([]);
  });
});
