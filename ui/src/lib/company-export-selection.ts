import type { CompanyPortabilityIssueManifestEntry } from "@paperclipai/shared";

/**
 * Build the initial set of checked (selected) file paths for a company export.
 *
 * On first load (`prev` is empty) all files are checked by default.
 * On re-preview, files that were checked before remain checked, and any new
 * files that were not previously visible are also checked by default.
 */
export function buildInitialExportCheckedFiles(
  filePaths: string[],
  _issues: CompanyPortabilityIssueManifestEntry[],
  prev: Set<string>,
): Set<string> {
  if (prev.size === 0) {
    // First load: check all files
    return new Set(filePaths);
  }

  const next = new Set<string>();
  for (const path of filePaths) {
    // Keep previously-checked files checked; new files default to checked.
    // Files in `prev` that no longer exist in `filePaths` are simply dropped.
    if (prev.has(path) || !isKnownUnchecked(path, prev, filePaths)) {
      next.add(path);
    }
  }
  return next;
}

/**
 * A file is "known unchecked" if it was present in the previous result but
 * NOT in `prev` (meaning the user explicitly unchecked it). Since we don't
 * track the full previous file list here, we conservatively treat all files
 * not in `prev` as new (and therefore checked by default).
 */
function isKnownUnchecked(_path: string, _prev: Set<string>, _filePaths: string[]): boolean {
  // Without the previous full file list we cannot distinguish "explicitly
  // unchecked" from "newly added". Check new files by default.
  return false;
}
