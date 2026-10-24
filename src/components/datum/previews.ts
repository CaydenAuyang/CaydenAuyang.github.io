// previews.ts: finds a project's preview recording at build time.
//
// The previews tool (tools/previews/) writes src/data/previews.json. Two shapes are accepted:
//   1. A list of clips (or { "previews": [...] }), one per recording:
//        { "id": "ourcityhealth-desktop", "projectId": "ourcityhealth", "framing": "desktop",
//          "width": 1280, "height": 800,
//          "src": { "mp4": "/media/...", "webm": "/media/...", "poster": "/media/..." } }
//   2. An object keyed by project id:  { "ourcityhealth": { "mp4", "webm", "poster" } }
// Ids are compared without dashes or case, so "civic-ai-club" matches "civicaiclub".
// The desktop 16:10 recording wins when a project has several. A clip whose files are not in
// public/ is skipped, so the page shows the "recording to come" frame instead of a broken video.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Clip {
  mp4: string;
  webm?: string;
  poster: string;
  width: number;
  height: number;
}

type Entry = Record<string, unknown>;

const found = import.meta.glob<unknown>('../../data/previews.json', { eager: true, import: 'default' });
const raw: unknown = Object.values(found)[0];

const norm = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

// Paths that start with "/" are served from public/; check the file is really there.
function present(path: string | undefined): boolean {
  if (!path) return false;
  if (!path.startsWith('/')) return true;
  return existsSync(join(process.cwd(), 'public', path));
}

function toClip(entry: Entry): Clip | undefined {
  const src = (entry.src && typeof entry.src === 'object' ? entry.src : entry) as Entry;
  const mp4 = str(src.mp4);
  const webm = str(src.webm);
  const poster = str(src.poster) ?? str(entry.poster);
  if (!mp4 || !poster || !present(mp4) || !present(poster)) return undefined;
  const width = Number(entry.width) || 1280;
  const height = Number(entry.height) || 800;
  return { mp4, webm: present(webm) ? webm : undefined, poster, width, height };
}

// Higher is better: desktop framing, then a 16:10 picture.
function score(entry: Entry, clip: Clip): number {
  let s = 0;
  if (norm(entry.framing) === 'desktop' || norm(entry.id).endsWith('desktop')) s += 2;
  if (Math.abs(clip.width / clip.height - 1.6) < 0.02) s += 1;
  return s;
}

export function clipFor(projectId: string, projectName: string): Clip | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const want = norm(projectId);
  const wantName = norm(projectName);

  const list: unknown = Array.isArray(raw) ? raw : (raw as Entry).previews;
  if (Array.isArray(list)) {
    let best: { clip: Clip; s: number } | undefined;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Entry;
      // projectId first, then the project's name, then the clip id ("aisimply-desktop").
      const matches =
        norm(entry.projectId) === want ||
        norm(entry.project) === wantName ||
        norm(entry.id).startsWith(want);
      if (!matches) continue;
      const clip = toClip(entry);
      if (!clip) continue;
      const s = score(entry, clip);
      if (!best || s > best.s) best = { clip, s };
    }
    return best?.clip;
  }

  // Keyed by project id (with or without dashes).
  for (const [key, value] of Object.entries(raw as Entry)) {
    if (norm(key) === want && value && typeof value === 'object') return toClip(value as Entry);
  }
  return undefined;
}
