/** Validate the full directory before filtering or executing any migrations.
 * Supabase records the numeric version, not the complete filename, as its key.
 * @param {string[]} files
 * @returns {string[]}
 */
export function validateMigrationFiles(files) {
  const versions = new Map();
  const sorted = [...files].sort();
  for (const file of sorted) {
    const match = /^(\d{14})_[a-z0-9_-]+\.sql$/.exec(file);
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}. Expected <14-digit-version>_<name>.sql. `
        + 'Check for cloud-sync conflict copies; do not rename a stale copy into a new migration.');
    }
    const version = match[1];
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version ${version}: ${versions.get(version)}, ${file}. `
        + 'Supabase migration history requires unique versions. Renumber only a confirmed undeployed migration.');
    }
    versions.set(version, file);
  }
  return sorted;
}
