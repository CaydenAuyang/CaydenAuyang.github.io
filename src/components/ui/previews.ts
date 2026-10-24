// previews.ts: finds a project's preview recording at build time, from src/data/previews.json
// (written by the previews tool). Clips match on projectId. A clip whose files are not in public/
// is skipped, so the page shows the "recording to come" frame instead of a broken video.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import previews from '../../data/previews.json';

export interface Clip {
  mp4: string;
  webm?: string;
  poster: string;
  width: number;
  height: number;
}

const present = (path: string | undefined) => !!path && existsSync(join(process.cwd(), 'public', path));

export function clipFor(projectId: string): Clip | undefined {
  const entry = previews.find((p) => p.projectId === projectId);
  if (!entry || !present(entry.src.mp4) || !present(entry.src.poster)) return undefined;
  return {
    mp4: entry.src.mp4,
    webm: present(entry.src.webm) ? entry.src.webm : undefined,
    poster: entry.src.poster,
    width: entry.width,
    height: entry.height,
  };
}
