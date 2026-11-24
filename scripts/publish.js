import { execFileSync, execSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ghpages from "gh-pages";

const repository = "https://github.com/baramrayyan/qs.git";
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function runGit(args, cwd, stdio = "pipe") {
  const output = execFileSync("git", args, { cwd, encoding: "utf8", stdio });
  return typeof output === "string" ? output.trim() : "";
}

function includeSourceFile(sourcePath) {
  const localPath = relative(projectRoot, sourcePath);
  if (!localPath) return true;
  const parts = localPath.split(sep);
  const filename = basename(localPath);
  if (parts.some((part) => [".git", "node_modules", "dist"].includes(part))) return false;
  if (filename === ".env.local" || /^\.env\..*\.local$/i.test(filename)) return false;
  if (filename === "firebase-config.local.js") return false;
  return true;
}

async function publish() {
  let temporaryRoot;
  try {
    console.log("Building the production site...");
    execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });

    temporaryRoot = await mkdtemp(join(tmpdir(), "qs-pages-publish-"));
    const resolvedTempRoot = resolve(temporaryRoot);
    const tempDirectoryRoot = `${resolve(tmpdir())}${sep}`;
    if (!resolvedTempRoot.startsWith(tempDirectoryRoot)) {
      throw new Error("Could not create a safe temporary publish folder.");
    }

    const sourceClone = join(temporaryRoot, "source");
    console.log("Preparing the source commit for main...");
    runGit(["clone", "--depth", "1", "--branch", "main", repository, sourceClone], temporaryRoot, "inherit");

    await cp(projectRoot, sourceClone, { recursive: true, filter: includeSourceFile });
    await rm(join(sourceClone, ".github", "workflows", "deploy-pages.yml"), { force: true });

    runGit(["add", "--all"], sourceClone, "inherit");
    if (runGit(["status", "--porcelain"], sourceClone)) {
      runGit(["var", "GIT_AUTHOR_IDENT"], sourceClone);
      runGit(["commit", "-m", "Publish source files"], sourceClone, "inherit");
      console.log("Pushing source files to main...");
      runGit(["push", "origin", "main"], sourceClone, "inherit");
    } else {
      console.log("Source files on main are already up to date.");
    }

    console.log("Publishing the built site to gh-pages...");
    await new Promise((resolvePublish, rejectPublish) => {
      ghpages.publish(resolve(projectRoot, "dist"), {
        branch: "gh-pages",
        repo: repository,
        nojekyll: true,
        message: "Deploy GitHub Pages",
      }, (error) => error ? rejectPublish(error) : resolvePublish());
    });

    console.log("Source files are on main and the built site is on gh-pages.");
  } finally {
    if (temporaryRoot) {
      const resolvedTempRoot = resolve(temporaryRoot);
      const tempDirectoryRoot = `${resolve(tmpdir())}${sep}`;
      if (resolvedTempRoot.startsWith(tempDirectoryRoot)) {
        await rm(resolvedTempRoot, { recursive: true, force: true });
      }
    }
  }
}

publish().catch((error) => {
  console.error("\nPublish failed:", error?.message || error);
  process.exitCode = 1;
});
