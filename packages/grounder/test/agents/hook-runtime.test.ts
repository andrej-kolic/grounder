import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractRuntimeNodePath,
  findRuntimeNodePathsInText,
  grounderRuntimeDir,
  installArtifacts,
  installHookRuntime,
  isGrounderPeekHookCommand,
  isHookRuntimeStale,
  peekHookCommand,
  runtimeCliPath,
  runtimeInvocation,
  runtimeManifestPath,
  shellQuote,
} from "../../src/agents/hook-runtime.js";
import { fileExists } from "../../src/util/fs.js";
import { createTempEnv } from "../helpers.js";

// `rename` is wrapped in a spy (defaulting to the real implementation) so a
// single test below can force a specific rename to fail — the double-failure
// promote/restore case installArtifacts's backup cleanup must not clobber.
// Every other export, and every other test in this file, is unaffected.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

/** `packages/grounder` — real checkout root, always outside the OS temp dir. */
const realPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Build a fake package under `dir` (itself inside `os.tmpdir()`) — an "ephemeral" source. */
async function writeFakePackage(dir: string, version: string): Promise<string> {
  await mkdir(path.join(dir, "dist"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  await writeFile(path.join(dir, "dist", "cli.js"), "// fake cli\n");
  return dir;
}

describe("agents/hook-runtime", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  describe("shellQuote", () => {
    it("wraps in single quotes", () => {
      expect(shellQuote("/usr/bin/node")).toBe("'/usr/bin/node'");
    });

    it("escapes embedded single quotes", () => {
      expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    });
  });

  describe("isGrounderPeekHookCommand", () => {
    it("matches legacy npx forms", () => {
      expect(isGrounderPeekHookCommand("npx grounder handoff peek")).toBe(true);
      expect(isGrounderPeekHookCommand("npx grounder handoff peek --json")).toBe(true);
      expect(isGrounderPeekHookCommand("  npx grounder handoff peek  ")).toBe(true);
    });

    it("matches home-runtime commands", () => {
      expect(
        isGrounderPeekHookCommand(
          "'/bin/node' '/Users/me/.grounder/runtime/dist/cli.js' handoff peek",
        ),
      ).toBe(true);
      expect(
        isGrounderPeekHookCommand(
          "'C:\\Program Files\\node.exe' 'C:\\Users\\me\\.grounder\\runtime\\dist\\cli.js' handoff peek",
        ),
      ).toBe(true);
    });

    it("rejects unrelated commands", () => {
      expect(isGrounderPeekHookCommand("npx grounder note hi")).toBe(false);
      expect(isGrounderPeekHookCommand("echo hello")).toBe(false);
      expect(isGrounderPeekHookCommand(undefined)).toBe(false);
    });
  });

  describe("extractRuntimeNodePath", () => {
    it("extracts the node path from a home-runtime invocation", () => {
      expect(
        extractRuntimeNodePath(
          "'/bin/node' '/Users/me/.grounder/runtime/dist/cli.js' handoff peek",
        ),
      ).toBe("/bin/node");
      expect(extractRuntimeNodePath(runtimeInvocation("/tmp/home"))).toBe(process.execPath);
      expect(extractRuntimeNodePath(`  ${peekHookCommand("/tmp/home")}  `)).toBe(process.execPath);
    });

    it("reverses shellQuote escaping for a path with an embedded quote", () => {
      const nodePath = "/Users/o'brien/.nvm/versions/node/v22.0.0/bin/node";
      const cmd = `${shellQuote(nodePath)} ${shellQuote("/home/me/.grounder/runtime/dist/cli.js")} handoff peek`;
      expect(cmd).toContain(`'\\''`);
      expect(extractRuntimeNodePath(cmd)).toBe(nodePath);
    });

    it("accepts Windows absolute paths", () => {
      expect(
        extractRuntimeNodePath(
          "'C:\\Program Files\\node.exe' 'C:\\Users\\me\\.grounder\\runtime\\dist\\cli.js' handoff peek",
        ),
      ).toBe("C:\\Program Files\\node.exe");
    });

    it("skips legacy npx forms (no absolute interpreter)", () => {
      expect(extractRuntimeNodePath("npx grounder handoff peek")).toBeNull();
      expect(extractRuntimeNodePath("npx grounder handoff peek --json")).toBeNull();
      expect(extractRuntimeNodePath("  npx grounder handoff peek  ")).toBeNull();
    });

    it("returns null for non-matching shapes", () => {
      expect(extractRuntimeNodePath(undefined)).toBeNull();
      expect(extractRuntimeNodePath("echo hello")).toBeNull();
      expect(extractRuntimeNodePath("'npx' 'grounder' handoff peek")).toBeNull();
      expect(extractRuntimeNodePath("'/bin/node' '/opt/other/cli.js' handoff peek")).toBeNull();
      expect(extractRuntimeNodePath("'/bin/node'")).toBeNull();
      // Relative / non-absolute first token — not the runtime shape
      expect(
        extractRuntimeNodePath(
          "'zzzUsers/me/.nvm/node' '/Users/me/.grounder/runtime/dist/cli.js' note x",
        ),
      ).toBeNull();
    });
  });

  describe("findRuntimeNodePathsInText", () => {
    it("finds invocations embedded mid-line (skill markdown)", () => {
      const text = [
        "Save a note.",
        "",
        "  '/opt/node' '/Users/me/.grounder/runtime/dist/cli.js' note \"<user text>\"",
        "",
        "Also run `'/bin/node' '/home/u/.grounder/runtime/dist/cli.js' handoff list --head`.",
      ].join("\n");
      expect(findRuntimeNodePathsInText(text)).toEqual(["/opt/node", "/bin/node"]);
    });

    it("dedupes repeated paths and skips non-runtime shapes", () => {
      const text = [
        "'/opt/node' '/x/.grounder/runtime/dist/cli.js' note a",
        "'/opt/node' '/x/.grounder/runtime/dist/cli.js' note b",
        "npx grounder note hi",
        "'zzzUsers/x' '/x/.grounder/runtime/dist/cli.js' note c",
      ].join("\n");
      expect(findRuntimeNodePathsInText(text)).toEqual(["/opt/node"]);
    });

    it("handles a path with an embedded quote without matching its own escape sequence", () => {
      // shellQuote renders an embedded `'` as the four characters `'\''`, so a
      // scan that visits every quote character starts three extra parses
      // *inside* one invocation. Each must fail rather than yield a second,
      // bogus path.
      const nodePath = "/opt/no'de";
      const text = `Run \`${shellQuote(nodePath)} ${shellQuote("/home/me/.grounder/runtime/dist/cli.js")} handoff peek\` first.`;
      expect(text).toContain(`'\\''`);
      expect(findRuntimeNodePathsInText(text)).toEqual([nodePath]);
    });
  });

  describe("peekHookCommand", () => {
    it("points at home runtime cli with quoted node path", () => {
      const cmd = peekHookCommand("/tmp/home");
      expect(cmd).toContain(shellQuote(process.execPath));
      expect(cmd).toContain(shellQuote(runtimeCliPath("/tmp/home")));
      expect(cmd).toContain("handoff peek");
      expect(cmd).not.toContain("npx");
    });

    it("appends extra args", () => {
      expect(peekHookCommand("/tmp/home", ["--json"])).toMatch(/handoff peek --json$/);
    });
  });

  describe("installHookRuntime", () => {
    it("symlinks dist/ for a durable source (the real package checkout)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await installHookRuntime({ homeDir: env.home });

      expect(result.status).toBe("created");
      expect(result.mode).toBe("symlink");
      expect(result.cliPath).toBe(runtimeCliPath(env.home));
      expect(await readFile(result.cliPath, "utf8")).toContain("handoff");

      const destDist = path.join(grounderRuntimeDir(env.home), "dist");
      const info = await lstat(destDist);
      expect(info.isSymbolicLink()).toBe(true);
      expect(await realpath(destDist)).toBe(await realpath(path.join(realPackageRoot, "dist")));

      const manifest = JSON.parse(await readFile(runtimeManifestPath(env.home), "utf8")) as {
        mode: string;
        version: string;
      };
      expect(manifest.mode).toBe("symlink");
      expect(manifest).not.toHaveProperty("nodePath");
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(grounderRuntimeDir(env.home)).toBe(path.join(env.home, ".grounder", "runtime"));
    });

    it("copies dist/ for an ephemeral source (npx-style temp cache)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "9.9.9");

      const result = await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      expect(result.status).toBe("created");
      expect(result.mode).toBe("copy");
      const destDist = path.join(grounderRuntimeDir(env.home), "dist");
      const info = await lstat(destDist);
      expect(info.isSymbolicLink()).toBe(false);
      expect(await readFile(result.cliPath, "utf8")).toContain("fake cli");

      const manifest = JSON.parse(await readFile(runtimeManifestPath(env.home), "utf8")) as {
        mode: string;
        version: string;
      };
      expect(manifest.mode).toBe("copy");
      expect(manifest).not.toHaveProperty("nodePath");
      expect(manifest.version).toBe("9.9.9");
    });

    it("also copies package.json and templates/ alongside dist/ in copy mode", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "9.9.9");
      await mkdir(path.join(fakeRoot, "templates", "agents"), { recursive: true });
      await writeFile(path.join(fakeRoot, "templates", "agents", "marker.txt"), "template\n");

      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      const runtimeDir = grounderRuntimeDir(env.home);
      expect(JSON.parse(await readFile(path.join(runtimeDir, "package.json"), "utf8"))).toEqual({
        version: "9.9.9",
      });
      expect(
        await readFile(path.join(runtimeDir, "templates", "agents", "marker.txt"), "utf8"),
      ).toBe("template\n");
    });

    it("skips templates/ in copy mode when the source has none (defensive — not expected in a real build)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "9.9.9");

      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      expect(await fileExists(path.join(grounderRuntimeDir(env.home), "templates"))).toBe(false);
    });

    it("does not copy package.json or templates/ in symlink mode (resolved through dist/'s own symlink)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await installHookRuntime({ homeDir: env.home });

      const runtimeDir = grounderRuntimeDir(env.home);
      expect(await fileExists(path.join(runtimeDir, "package.json"))).toBe(false);
      expect(await fileExists(path.join(runtimeDir, "templates"))).toBe(false);
    });

    it("overwrites an existing runtime on re-install", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await installHookRuntime({ homeDir: env.home });
      const second = await installHookRuntime({ homeDir: env.home });
      expect(second.status).toBe("overwritten");
    });

    it("transitions cleanly from copy mode to symlink mode, dropping the copy-mode siblings", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.0.0");
      await mkdir(path.join(fakeRoot, "templates"), { recursive: true });
      await writeFile(path.join(fakeRoot, "templates", "marker.txt"), "template\n");

      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });
      const runtimeDir = grounderRuntimeDir(env.home);
      expect(await fileExists(path.join(runtimeDir, "package.json"))).toBe(true);
      expect(await fileExists(path.join(runtimeDir, "templates"))).toBe(true);

      const second = await installHookRuntime({ homeDir: env.home });

      expect(second.mode).toBe("symlink");
      const destDist = path.join(runtimeDir, "dist");
      expect((await lstat(destDist)).isSymbolicLink()).toBe(true);
      // Leftover copy-mode siblings would be harmless (symlinked dist/
      // resolves through to the real package root regardless) but would
      // confuse anyone inspecting ~/.grounder/runtime — must be removed.
      expect(await fileExists(path.join(runtimeDir, "package.json"))).toBe(false);
      expect(await fileExists(path.join(runtimeDir, "templates"))).toBe(false);
    });

    it("keeps the previous runtime when staging the replacement fails", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.0.0");

      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });
      const previous = await readFile(runtimeCliPath(env.home), "utf8");

      // Read-only runtime dir: staging cannot be created, so install must fail
      // without removing the live dist/ hooks already point at.
      const runtimeDir = grounderRuntimeDir(env.home);
      await chmod(runtimeDir, 0o555);
      try {
        await expect(
          installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot }),
        ).rejects.toThrow();
        expect(await readFile(runtimeCliPath(env.home), "utf8")).toBe(previous);
        expect(await fileExists(path.join(runtimeDir, "dist.staging"))).toBe(false);
        expect(await fileExists(path.join(runtimeDir, "dist.bak"))).toBe(false);
      } finally {
        await chmod(runtimeDir, 0o755);
      }
    });

    it("refuses to materialize the runtime from itself", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      // Simulates running a command directly against the materialized
      // runtime's own dist/cli.js instead of the real grounder/npx grounder
      // entrypoint — defaultPackageRoot would then resolve to the runtime
      // dir itself, which has no real upstream source to symlink/copy from.
      await installHookRuntime({ homeDir: env.home });
      const runtimeDir = grounderRuntimeDir(env.home);

      await expect(
        installHookRuntime({ homeDir: env.home, packageRoot: runtimeDir }),
      ).rejects.toThrow(/refusing to materialize/i);
    });
  });

  describe("installArtifacts", () => {
    it("promotes every artifact when all populate calls succeed", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const destA = path.join(env.repo, "a", "artifact.txt");
      const destB = path.join(env.repo, "b", "artifact.txt");
      await mkdir(path.dirname(destA), { recursive: true });
      await mkdir(path.dirname(destB), { recursive: true });

      await installArtifacts([
        { dest: destA, populate: (staging) => writeFile(staging, "new-a\n") },
        { dest: destB, populate: (staging) => writeFile(staging, "new-b\n") },
      ]);

      expect(await readFile(destA, "utf8")).toBe("new-a\n");
      expect(await readFile(destB, "utf8")).toBe("new-b\n");
      expect(await fileExists(`${destA}.staging`)).toBe(false);
      expect(await fileExists(`${destA}.bak`)).toBe(false);
      expect(await fileExists(`${destB}.staging`)).toBe(false);
      expect(await fileExists(`${destB}.bak`)).toBe(false);
    });

    it("rolls back an already-promoted artifact when a later artifact fails to promote", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const dirA = path.join(env.repo, "a");
      const dirB = path.join(env.repo, "b");
      const destA = path.join(dirA, "artifact.txt");
      const destB = path.join(dirB, "artifact.txt");
      await mkdir(dirA, { recursive: true });
      await mkdir(dirB, { recursive: true });
      await writeFile(destA, "old-a\n");
      await writeFile(destB, "old-b\n");

      try {
        // B's populate writes its staging content (still needs dirB
        // writable for that), then locks dirB down as its last act — so B's
        // own promote (which needs to rename *within* dirB) fails, but only
        // after A has already promoted successfully in the prior iteration.
        await expect(
          installArtifacts([
            { dest: destA, populate: (staging) => writeFile(staging, "new-a\n") },
            {
              dest: destB,
              populate: async (staging) => {
                await writeFile(staging, "new-b\n");
                await chmod(dirB, 0o555);
              },
            },
          ]),
        ).rejects.toThrow();

        // A was promoted, then rolled back — must read back as untouched.
        expect(await readFile(destA, "utf8")).toBe("old-a\n");
        expect(await fileExists(`${destA}.staging`)).toBe(false);
        expect(await fileExists(`${destA}.bak`)).toBe(false);

        // B's own promote never got past its first rename — untouched too.
        await chmod(dirB, 0o755);
        expect(await readFile(destB, "utf8")).toBe("old-b\n");
      } finally {
        await chmod(dirB, 0o755);
      }
    });

    it("keeps the backup when both the promote rename and its restore attempt fail", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const dir = path.join(env.repo, "artifact-dir");
      const dest = path.join(dir, "artifact.txt");
      const staging = `${dest}.staging`;
      const backup = `${dest}.bak`;
      await mkdir(dir, { recursive: true });
      await writeFile(dest, "old\n");

      const { rename: realRename } =
        await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const renameMock = vi.mocked(rename);
      // `rename(dest, backup)` (the first rename) must go through for real —
      // only the promote (`staging` -> `dest`) and its restore attempt
      // (`backup` -> `dest`) fail, simulating whatever transient fault broke
      // the promote also blocking the rename straight back.
      renameMock.mockImplementation(async (from, to) => {
        if ((from === staging || from === backup) && to === dest) {
          const error = new Error("EACCES: simulated") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        return realRename(from as string, to as string);
      });

      try {
        await expect(
          installArtifacts([{ dest, populate: (s) => writeFile(s, "new\n") }]),
        ).rejects.toThrow();

        // dest is gone (both the promote and its restore failed), but the
        // original content must still be sitting in `backup` — not deleted.
        expect(await fileExists(dest)).toBe(false);
        expect(await readFile(backup, "utf8")).toBe("old\n");
      } finally {
        renameMock.mockImplementation(realRename);
      }
    });
  });

  describe("isHookRuntimeStale", () => {
    it("is never stale when packageRoot resolves to the runtime dir itself (self-invocation)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      // A copy-mode install whose dist/ is a plain directory, not a symlink
      // — the exact shape that would otherwise misread as "should be a
      // symlink, but isn't" once compared against itself.
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");
      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      expect(await isHookRuntimeStale(env.home, grounderRuntimeDir(env.home))).toBe(false);
    });

    it("is stale when the runtime was never installed", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      expect(await isHookRuntimeStale(env.home)).toBe(true);
    });

    it("is fresh right after a symlink install (durable source)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await installHookRuntime({ homeDir: env.home });

      expect(await isHookRuntimeStale(env.home)).toBe(false);
    });

    it("is stale when the symlink resolves to a different source than expected", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await installHookRuntime({ homeDir: env.home });

      expect(await isHookRuntimeStale(env.home, path.join(env.repo, "some-other-checkout"))).toBe(
        true,
      );
    });

    it("is fresh right after a copy install with a matching version (ephemeral source)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");

      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      expect(await isHookRuntimeStale(env.home, fakeRoot)).toBe(false);
    });

    it("is stale when the copied runtime's version no longer matches the source", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");
      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      // Simulate an upgrade: the source package.json now reports a newer version.
      await writeFile(
        path.join(fakeRoot, "package.json"),
        `${JSON.stringify({ version: "1.3.0" }, null, 2)}\n`,
      );

      expect(await isHookRuntimeStale(env.home, fakeRoot)).toBe(true);
    });

    it("is stale when the copy manifest is missing or unreadable", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");
      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });
      await writeFile(runtimeManifestPath(env.home), "{ not valid json");

      expect(await isHookRuntimeStale(env.home, fakeRoot)).toBe(true);
    });

    it("is stale when a copy-mode runtime's package.json is missing (same-version repair case)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");
      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      // Simulates a runtime materialized before package.json was copied
      // alongside dist/ (or one left behind by a partial install) — the
      // manifest still reports a matching version, so a version-only check
      // would never repair it.
      await rm(path.join(grounderRuntimeDir(env.home), "package.json"));

      expect(await isHookRuntimeStale(env.home, fakeRoot)).toBe(true);
    });

    it("is stale when a copy-mode runtime is missing templates/ that the source has", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");
      await mkdir(path.join(fakeRoot, "templates"), { recursive: true });
      await writeFile(path.join(fakeRoot, "templates", "marker.txt"), "template\n");
      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      await rm(path.join(grounderRuntimeDir(env.home), "templates"), { recursive: true });

      expect(await isHookRuntimeStale(env.home, fakeRoot)).toBe(true);
    });

    it("is fresh when a copy-mode source has no templates/ and the runtime has none either", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const fakeRoot = await writeFakePackage(path.join(env.repo, "fake-pkg"), "1.2.3");
      await installHookRuntime({ homeDir: env.home, packageRoot: fakeRoot });

      expect(await isHookRuntimeStale(env.home, fakeRoot)).toBe(false);
    });
  });
});
