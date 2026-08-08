import { hasSecretKey } from "./secureStore";

export interface EnvProblem {
  /** Human-readable description of what is wrong. */
  message: string;
  /** Whether the server can still start. Warnings degrade features; errors do not. */
  fatal: boolean;
}

/**
 * Checks the environment the web server actually needs, so misconfiguration
 * surfaces as one clear message at startup instead of an opaque failure on the
 * first request. Deliberately lenient: only WEB_SECRET_KEY is fatal, because
 * without it no secret can be read or written. GITHUB_TOKEN is a warning — the
 * dashboard is designed to let you paste it into the Settings page on first run,
 * and GITHUB_OWNER/REPO are optional by design (auto-detected from the host
 * repo's git remote when unset).
 */
export function checkEnv(): EnvProblem[] {
  const problems: EnvProblem[] = [];

  if (!hasSecretKey()) {
    problems.push({
      fatal: true,
      message:
        "WEB_SECRET_KEY is missing or too short (need 16+ characters).\n" +
        "  Tokens cannot be encrypted at rest without it.\n" +
        '  Generate one:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
        "  Then add it to web/server/.env — see web/server/.env.example."
    });
  }

  if (!process.env.GITHUB_TOKEN) {
    problems.push({
      fatal: false,
      message:
        "GITHUB_TOKEN is not set. The dashboard will start, but GitHub calls fail until you\n" +
        "  add a token on the Settings page (or set it in .env). Needs `repo` scope."
    });
  }

  const port = process.env.WEB_SERVER_PORT;
  if (port !== undefined && !/^\d+$/.test(port.trim())) {
    problems.push({
      fatal: true,
      message: `WEB_SERVER_PORT must be a number, got "${port}".`
    });
  }

  return problems;
}

/**
 * Prints any problems and returns false when the server must not start. Keeps
 * the message format consistent so the README's troubleshooting section can
 * quote it verbatim.
 */
export function reportEnv(problems: EnvProblem[]): boolean {
  const fatal = problems.filter((p) => p.fatal);
  const warnings = problems.filter((p) => !p.fatal);

  for (const w of warnings) {
    console.warn(`[web-server] warning: ${w.message}`);
  }
  for (const f of fatal) {
    console.error(`[web-server] error: ${f.message}`);
  }
  if (fatal.length > 0) {
    console.error("[web-server] Refusing to start with the errors above.");
    return false;
  }
  return true;
}
