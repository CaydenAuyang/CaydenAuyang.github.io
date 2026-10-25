// previews.ts: finds a project's preview recording at build time, from src/data/previews.json
// (written by the previews tool). Clips match on projectId. A clip whose files are not in public/
// is skipped, so the page shows the "recording to come" frame instead of a broken video.
//
// Each clip has the 1280px desktop encode and, under `small`, 720px encodes of about 600 KB (V4.md
// 8.7) that phones and phones sideways play instead (loop-video.ts picks one by layout). A small
// file that is missing is left out, and that layout plays the desktop file.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import previews from '../../data/previews.json';

export interface Clip {
  mp4: string;
  webm?: string;
  /** The 720px encodes, when present. */
  small?: { mp4: string; webm?: string };
  poster: string;
  width: number;
  height: number;
}

const present = (path: string | undefined) => !!path && existsSync(join(process.cwd(), 'public', path));

export function clipFor(projectId: string): Clip | undefined {
  const entry = previews.find((p) => p.projectId === projectId);
  if (!entry || !present(entry.src.mp4) || !present(entry.src.poster)) return undefined;
  const small = 'small' in entry && present(entry.small?.mp4) ? entry.small : undefined;
  return {
    mp4: entry.src.mp4,
    webm: present(entry.src.webm) ? entry.src.webm : undefined,
    small: small && { mp4: small.mp4, webm: present(small.webm) ? small.webm : undefined },
    poster: entry.src.poster,
    width: entry.width,
    height: entry.height,
  };
}
