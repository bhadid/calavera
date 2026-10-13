export function bytes(n: number | null | undefined): string {
  if (n == null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function timeOfDay(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The page for an album, from its Apple Music link, e.g.
 * https://music.apple.com/de/album/some-name/123 -> /album/123?sf=de.
 * Returns null for anything that is not a plain album link.
 */
export function albumPath(url: string): string | null {
  const match = /music\.apple\.com\/([a-z]{2})\/album\/(?:[^/?#]+\/)?(\d+)(?:[?#](.*))?$/.exec(url.trim());
  if (!match || /(^|[?&])i=\d/.test(match[3] ?? "")) return null;
  return `/album/${match[2]}?sf=${match[1]}`;
}

/**
 * The page for the album a song is on, from the song's Apple Music link, e.g.
 * https://music.apple.com/de/album/some-name/123?i=456 -> /album/123?sf=de.
 * Returns null for a link that does not name the album.
 */
export function songAlbumPath(url: string): string | null {
  const match = /music\.apple\.com\/([a-z]{2})\/album\/(?:[^/?#]+\/)?(\d+)\?(?:.*&)?i=\d/.exec(url.trim());
  return match ? `/album/${match[2]}?sf=${match[1]}` : null;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function year(date: string): string {
  return date.slice(0, 4);
}

/** "24-bit / 192 kHz", written as in the queue's results. */
export function qualityNumbers(quality: { sample_rate: number; bit_depth: number }): string {
  return `${quality.bit_depth}-bit / ${quality.sample_rate / 1000} kHz`;
}

/** "Lossless", "Hi-Res Lossless" or "" from Apple's audioTraits. */
export function qualityLabel(traits: string[]): string {
  if (traits.includes("hi-res-lossless")) return "Hi-Res Lossless";
  if (traits.includes("lossless")) return "Lossless";
  return "";
}
