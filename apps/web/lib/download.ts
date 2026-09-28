/**
 * Saves a fetched file through a temporary link. The object URL is revoked
 * later, not right after click(): Safari and Firefox can cancel a download
 * whose URL disappears before they start reading it.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
