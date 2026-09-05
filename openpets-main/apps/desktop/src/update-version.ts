export interface UpdateStatusFromReleaseInput {
  readonly tag_name?: unknown;
  readonly name?: unknown;
  readonly html_url?: unknown;
}

export interface ParsedUpdateStatus {
  readonly state: "available" | "current";
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly releaseUrl: string;
  readonly checkedAt: number;
}

export function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function createParsedUpdateStatus(currentVersion: string, release: UpdateStatusFromReleaseInput, checkedAt: number, repository: string, releasesPageUrl: string): ParsedUpdateStatus {
  const latestVersion = normalizeVersion(release.tag_name) || normalizeVersion(release.name);
  if (!latestVersion) throw new Error("Latest GitHub release did not include a valid version tag.");
  const releaseUrl = validateGitHubReleaseUrl(release.html_url, repository) || releasesPageUrl;
  return {
    state: isVersionNewer(latestVersion, currentVersion) ? "available" : "current",
    currentVersion,
    latestVersion,
    releaseUrl,
    checkedAt,
  };
}

function validateGitHubReleaseUrl(value: unknown, repository: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    if (!url.pathname.startsWith(`/${repository}/releases/`)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const nextParts = parseVersionParts(candidate);
  const currentParts = parseVersionParts(current);
  if (!nextParts || !currentParts) return false;
  for (let index = 0; index < nextParts.length; index += 1) {
    if (nextParts[index] > currentParts[index]) return true;
    if (nextParts[index] < currentParts[index]) return false;
  }
  return false;
}

function parseVersionParts(value: string): readonly [number, number, number] | null {
  const version = normalizeVersion(value);
  if (!version) return null;
  const [major, minor, patch] = version.split(".").map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) && Number.isInteger(patch) ? [major, minor, patch] : null;
}
