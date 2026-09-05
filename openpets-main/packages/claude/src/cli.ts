#!/usr/bin/env node
import { runClaudeHookFromStdin } from "./hooks.js";
import { doctorClaudeHooks, findInstalledOpenPetsClaudeCli, installClaudeHooks, uninstallClaudeHooks } from "./hook-settings.js";
import { validateOpenPetsPetArg } from "./claude-code.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "hook") {
    const code = await runClaudeHookFromStdin(process.stdin, { configuredPetId: readPetArg(args), projectLocal: hasProjectLocalArg(args), debug: process.env.OPENPETS_DEBUG === "1" });
    process.exitCode = code;
    return;
  }
  if (command === "doctor-hooks") {
    // Resolve the same bundled-CLI path install-hooks would use, so a correct
    // bundled install reports "installed" rather than a false "needs_update".
    const installedCliPath = resolveInstalledClaudeCliPath(args);
    process.stderr.write(`${JSON.stringify(doctorClaudeHooks(readPathArg(args), undefined, readPetArg(args), "node", installedCliPath ?? undefined), null, 2)}\n`);
    return;
  }
  if (command === "install-hooks") {
    // Prefer the bundled CLI inside an installed OpenPets app: hooks then run as
    // `node <abs-path> hook ...`, paying no package-manager resolution cost per
    // firing. Fall back to the `npx -y @open-pets/claude` published command when
    // no install is found or the user opts out with --prefer-npx.
    const installedCliPath = resolveInstalledClaudeCliPath(args);
    process.stderr.write(`${JSON.stringify(installClaudeHooks(readPathArg(args), undefined, readPetArg(args), "node", installedCliPath ?? undefined), null, 2)}\n`);
    return;
  }
  if (command === "uninstall-hooks") {
    process.stderr.write(`${JSON.stringify(uninstallClaudeHooks(readPathArg(args)), null, 2)}\n`);
    return;
  }
  process.stderr.write("Usage: open-pets-claude <hook|doctor-hooks|install-hooks|uninstall-hooks> [--settings <path>] [--pet <id>] [--prefer-npx]\n");
  process.exitCode = 1;
}

function readPathArg(args: readonly string[]): string | undefined {
  const index = args.indexOf("--settings");
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && value.length > 0 ? value : undefined;
}

function readPetArg(args: readonly string[]): string | undefined {
  const equals = args.find((arg) => arg.startsWith("--pet="));
  if (equals) return validateOpenPetsPetArg(equals.slice("--pet=".length));
  const index = args.indexOf("--pet");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error("Missing value for --pet.");
  return value && value.length > 0 ? validateOpenPetsPetArg(value) : undefined;
}

function hasProjectLocalArg(args: readonly string[]): boolean {
  return args.includes("--project-local");
}

// install-hooks and doctor-hooks must resolve the hook command identically:
// prefer an installed OpenPets app's bundled CLI unless --prefer-npx is passed
// or no app is found. Resolving asymmetrically makes doctor-hooks report a
// correct bundled install as needs_update.
function resolveInstalledClaudeCliPath(args: readonly string[]): string | null {
  if (args.includes("--prefer-npx")) return null;
  return findInstalledOpenPetsClaudeCli();
}

main().catch((error: unknown) => {
  process.stderr.write(`OpenPets Claude CLI failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
