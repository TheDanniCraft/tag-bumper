const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRequire } = require("node:module");
const run = promisify(execFile);
const project = path.resolve(__dirname, ".."),
  realRequire = createRequire(project + "/package.json");
test("CLI updates a version tag and matching root tag only in a disposable local remote", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "tag-bumper-test-")),
    cwd = process.cwd();
  const git = async (args, dir) => {
    return (await run("git", args, { cwd: dir })).stdout.trim();
  };
  try {
    const origin = path.join(fixture, "origin.git"),
      working = path.join(fixture, "working");
    await git(["init", "--bare", origin], fixture);
    await git(["clone", origin, working], fixture);
    await fs.writeFile(working + "/fixture.txt", "first");
    await git(["add", "."], working);
    const commit = [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
    ];
    await git([...commit, "first"], working);
    await git(["tag", "v1"], working);
    await git(["tag", "v1.0.0"], working);
    await git(["push", "origin", "HEAD", "--tags"], working);
    await fs.writeFile(working + "/fixture.txt", "second");
    await git(["add", "."], working);
    await git([...commit, "second"], working);
    const expected = await git(["rev-parse", "HEAD"], working);
    const selections = ["update", "v1.0.0"];
    const output = [];
    const prompts = realRequire("@inquirer/prompts");
    const dependencies = (id) =>
      id === "@inquirer/prompts"
        ? {
            ...prompts,
            select: async () => selections.shift(),
            confirm: async () => true,
          }
        : realRequire(id);
    const source = (await fs.readFile(project + "/index.js", "utf8"))
      .replace(/^#![^\n]*\n/, "")
      .replace(/main\(\);\s*$/, "return main();");
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    process.chdir(working);
    await new AsyncFunction("require", "process", "console", source)(
      dependencies,
      {
        exit: (code) => {
          throw Error("Unexpected CLI exit " + code);
        },
      },
      {
        log: (...args) => output.push(args.join(" ")),
        error: (...args) => output.push(args.join(" ")),
      },
    );
    assert.equal(
      await git(["--git-dir=" + origin, "rev-parse", "v1.0.0"], fixture),
      expected,
    );
    assert.equal(
      await git(["--git-dir=" + origin, "rev-parse", "v1"], fixture),
      expected,
    );
    assert(output.some((line) => line.includes("Summary of changes:")));
    assert.equal(selections.length, 0);
  } finally {
    process.chdir(cwd);
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
