/**
 * Format bytes to human readable string.
 * Shows MB for < 1GB, GB for < 1TB, TB for >= 1TB
 */
export function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

/**
 * Format bytes specifically as TB (for drive-level totals)
 */
export function formatTB(bytes) {
  if (!bytes || bytes === 0) return '0 TB';
  return `${(bytes / (1024 ** 4)).toFixed(2)} TB`;
}

/**
 * Format bytes as GB (for medium sizes)
 */
export function formatGB(bytes) {
  if (!bytes || bytes === 0) return '0 GB';
  return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
}
