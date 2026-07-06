/**
 * trackform.js — shared track metadata form used by submit.html (artists)
 * and admin.html (review queue + edit-any-track).
 *
 * The source-songs block is REQUIRED and structured: one artist/title pair
 * per row, matching the `sourceSongs` schema from Prompt 1 exactly. That's
 * what keeps the Mashup Explorer's connections accurate.
 */
import { fetchVideoMeta, parseSourceSongs, ytEnabled } from './ytmeta.js';

const esc = (s) => (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function formHtml(entry = {}, { showMedia = true } = {}) {
  const songs = entry.sourceSongs?.length ? entry.sourceSongs : [{ artist: '', title: '' }, { artist: '', title: '' }];
  const at = entry.audio?.type;
  const mediaKind = at === 'pcloud' ? 'pcloud'
    : at === 'dropbox' ? 'dropbox'
    : at === 'onedrive' ? 'onedrive'
    : at === 'gdrive' ? 'gdrive'
    : at === 'direct' ? 'direct'
    : entry.audio?.publicLink ? 'pcloud'
    : entry.audio?.url ? 'upload'
    : entry.video?.type === 'youtube' ? 'youtube'
    : entry.video?.type === 'tiktok' ? 'tiktok' : 'upload';
  return `
  <div class="f"><label>Mashup title *</label><input class="tf-title" value="${esc(entry.displayTitle)}" placeholder="e.g. 3 Smiles"></div>
  <div class="grid2">
    <div class="f"><label>Year</label><input class="tf-year" value="${esc(entry.year)}" placeholder="2026"></div>
    <div class="f"><label>Special collection</label><input class="tf-special" value="${esc(entry.specialAlbum)}" placeholder="optional"></div>
  </div>
  <div class="f"><label>Source songs — one row per song, artist + title *</label>
    <div class="tf-songs">${songs.map(songRowHtml).join('')}</div>
    <button type="button" class="chip tf-addsong" style="margin-top:6px">＋ Add another song</button>
  </div>
  ${showMedia ? `
  <div class="f"><label>Where does the mashup live? *</label>
    <select class="tf-media">
      <option value="upload" ${mediaKind === 'upload' ? 'selected' : ''}>Upload an audio/video file here</option>
      <option value="youtube" ${mediaKind === 'youtube' ? 'selected' : ''}>YouTube link (my own channel)</option>
      <option value="tiktok" ${mediaKind === 'tiktok' ? 'selected' : ''}>TikTok link (my own account)</option>
      <option value="pcloud" ${mediaKind === 'pcloud' ? 'selected' : ''}>pCloud public link (my own hosting)</option>
      <option value="dropbox" ${mediaKind === 'dropbox' ? 'selected' : ''}>Dropbox share link</option>
      <option value="onedrive" ${mediaKind === 'onedrive' ? 'selected' : ''}>OneDrive share link</option>
      <option value="gdrive" ${mediaKind === 'gdrive' ? 'selected' : ''}>Google Drive share link</option>
      <option value="direct" ${mediaKind === 'direct' ? 'selected' : ''}>Direct file URL (S3 · R2 · B2 · any host)</option>
    </select>
  </div>
  <div class="f tf-file-f"><label>File (mp3, m4a, wav, ogg, mp4 — max 50 MB on our current storage plan)</label>
    <input type="file" class="tf-file" accept="audio/*,video/mp4,video/webm">
    ${entry.audio?.url ? `<div class="tf-hint">Current file stays unless you pick a new one.</div>` : ''}
  </div>
  <div class="f tf-link-f hidden"><label class="tf-link-label">Link</label>
    <input class="tf-link" value="${esc(entry.audio?.publicLink || (entry.video?.type === 'tiktok' ? entry.video?.sourceId : '') || (entry.video?.type === 'youtube' && entry.video?.sourceId ? 'https://youtu.be/' + entry.video.sourceId : ''))}" placeholder="https://…">
    <button type="button" class="chip tf-yt-autofill hidden" style="margin-top:8px">↧ Autofill songs from YouTube</button>
    <div class="tf-yt-status" style="font-size:12px;color:var(--text-dim);margin-top:6px;min-height:1em"></div>
  </div>` : ''}`;
}

export function songRowHtml(s = { artist: '', title: '' }) {
  return `<div class="songrow">
    <input class="sr-artist" placeholder="Song artist — use ; between multiple artists" value="${esc(s.artist)}">
    <input class="sr-title" placeholder="Song title" value="${esc(s.title)}">
    <button type="button" class="sr-del" title="Remove">✕</button>
  </div>`;
}

/**
 * Fill the source-song rows in `root` from parsed candidates WITHOUT
 * overwriting anything the user already typed: blank rows get filled first,
 * then extra candidates are appended as new rows. Returns how many were added.
 */
export function fillEmptySongRows(root, songs) {
  const box = root.querySelector('.tf-songs');
  let added = 0;
  for (const s of songs) {
    if (!s.artist && !s.title) continue;
    let target = [...box.querySelectorAll('.songrow')].find((r) =>
      !r.querySelector('.sr-artist').value.trim() && !r.querySelector('.sr-title').value.trim());
    if (!target) {
      box.insertAdjacentHTML('beforeend', songRowHtml());
      target = box.lastElementChild;
    }
    target.querySelector('.sr-artist').value = s.artist || '';
    target.querySelector('.sr-title').value = s.title || '';
    added++;
  }
  return added;
}

/** Wire up add/remove song rows + media-kind switching inside `root`. */
export function bindForm(root) {
  root.addEventListener('click', async (e) => {
    if (e.target.closest('.tf-addsong')) {
      root.querySelector('.tf-songs').insertAdjacentHTML('beforeend', songRowHtml());
    }
    const del = e.target.closest('.sr-del');
    if (del && root.querySelectorAll('.songrow').length > 1) del.closest('.songrow').remove();

    const auto = e.target.closest('.tf-yt-autofill');
    if (auto) {
      const status = root.querySelector('.tf-yt-status');
      const say = (msg) => { if (status) status.textContent = msg; };
      const id = parseYouTubeId(root.querySelector('.tf-link')?.value || '');
      if (!id) return say('Paste a YouTube link above first.');
      auto.disabled = true;
      say('Reading the YouTube video…');
      try {
        const meta = await fetchVideoMeta(id);
        const songs = parseSourceSongs(meta);
        if (!songs.length) { say('Couldn’t find song info in that video’s title or description — add them by hand.'); return; }
        const added = fillEmptySongRows(root, songs);
        say(`Added ${added} song${added === 1 ? '' : 's'} from “${meta.title.slice(0, 60)}”. Please double-check them.`);
      } catch (err) {
        say(err.message || 'Autofill failed.');
      } finally {
        auto.disabled = false;
      }
    }
  });
  const media = root.querySelector('.tf-media');
  if (media) {
    const sync = () => {
      const v = media.value;
      root.querySelector('.tf-file-f')?.classList.toggle('hidden', v !== 'upload');
      root.querySelector('.tf-link-f')?.classList.toggle('hidden', v === 'upload');
      const lbl = root.querySelector('.tf-link-label');
      const LABELS = { youtube: 'YouTube video link', tiktok: 'TikTok video link',
        pcloud: 'pCloud public link', dropbox: 'Dropbox share link',
        onedrive: 'OneDrive share link', gdrive: 'Google Drive share link',
        direct: 'Direct file URL' };
      if (lbl) lbl.textContent = LABELS[v] || 'Link';
      // Autofill only makes sense for YouTube, and only if a key is configured.
      root.querySelector('.tf-yt-autofill')?.classList.toggle('hidden', !(v === 'youtube' && ytEnabled()));
      const st = root.querySelector('.tf-yt-status'); if (st) st.textContent = '';
    };
    media.addEventListener('change', sync);
    sync();
  }
}

/**
 * Read + validate the form. Returns { entry, file, mediaKind } or throws
 * an Error with a user-readable message. `base` = existing entry when editing.
 */
export function readForm(root, base = {}) {
  const title = root.querySelector('.tf-title').value.trim();
  if (!title) throw new Error('Give the mashup a title.');

  const sourceSongs = [...root.querySelectorAll('.songrow')].map((r) => ({
    artist: r.querySelector('.sr-artist').value.trim(),
    title: r.querySelector('.sr-title').value.trim(),
  })).filter((s) => s.artist || s.title);
  if (!sourceSongs.length) throw new Error('Add at least one source song (artist + title).');
  for (const s of sourceSongs) {
    if (!s.artist || !s.title) throw new Error('Every source-song row needs BOTH an artist and a title.');
  }

  const entry = {
    ...base,
    displayTitle: title,
    sourceSongs,
    year: root.querySelector('.tf-year').value.trim() || undefined,
    specialAlbum: root.querySelector('.tf-special').value.trim() || undefined,
  };
  if (!entry.year) delete entry.year;
  if (!entry.specialAlbum) delete entry.specialAlbum;

  const media = root.querySelector('.tf-media');
  if (!media) return { entry, file: null, mediaKind: null };

  const mediaKind = media.value;
  const link = root.querySelector('.tf-link')?.value.trim() || '';
  const file = root.querySelector('.tf-file')?.files[0] || null;

  if (mediaKind === 'upload') {
    if (!file && !base.audio?.url) throw new Error('Choose a file to upload.');
    // audio/video set by caller after upload completes
  } else if (mediaKind === 'youtube') {
    const id = parseYouTubeId(link);
    if (!id) throw new Error('That does not look like a YouTube link.');
    entry.video = { type: 'youtube', sourceId: id };
    delete entry.audio;
  } else if (mediaKind === 'tiktok') {
    if (!/tiktok\.com\//.test(link)) throw new Error('That does not look like a TikTok link.');
    entry.video = { type: 'tiktok', sourceId: link };
    delete entry.audio;
  } else if (mediaKind === 'pcloud') {
    if (!/pcloud\.(link|com)\//.test(link)) throw new Error('That does not look like a pCloud public link.');
    entry.audio = { type: 'pcloud', publicLink: link };
    delete entry.video;
  } else if (mediaKind === 'dropbox') {
    const url = dropboxDirect(link);
    if (!url) throw new Error('That does not look like a Dropbox share link.');
    entry.audio = { type: 'dropbox', publicLink: link, url };
    delete entry.video;
  } else if (mediaKind === 'onedrive') {
    const url = oneDriveDirect(link);
    if (!url) throw new Error('That does not look like a OneDrive share link.');
    entry.audio = { type: 'onedrive', publicLink: link, url };
    delete entry.video;
  } else if (mediaKind === 'gdrive') {
    const url = googleDriveDirect(link);
    if (!url) throw new Error('That does not look like a Google Drive file link.');
    entry.audio = { type: 'gdrive', publicLink: link, url };
    delete entry.video;
  } else if (mediaKind === 'direct') {
    const url = directUrl(link);
    if (!url) throw new Error('Paste a direct https:// link to an audio or video file.');
    entry.audio = { type: 'direct', publicLink: link, url };
    delete entry.video;
  }
  return { entry, file, mediaKind };
}

export function parseYouTubeId(url) {
  const m = (url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
  return m ? m[1] : null;
}

/* ---------------- cloud-drive link → direct streamable URL ----------------
   The player streams any `audio.url` directly (see player.js), so for these
   hosts we transform the share link into a direct, range-capable file URL at
   submit time and store it as `audio.url`. `audio.publicLink` keeps the
   original link so the edit form can show it again. */

/** Dropbox: a share link → direct download host (streams + supports seeking). */
export function dropboxDirect(url) {
  const v = (url || '').trim();
  if (!/dropbox\.com\//.test(v)) return null;
  let u = v
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('://dropbox.com', '://dl.dropboxusercontent.com');
  u = u.replace(/([?&])dl=0(&|$)/, '$1dl=1$2');
  if (!/[?&]dl=1(&|$)/.test(u)) u += (u.includes('?') ? '&' : '?') + 'dl=1';
  return u;
}

/** OneDrive: encode the share URL the way Microsoft's "shares" API expects,
    then hit the anonymous content endpoint that 302s to the real file. */
export function oneDriveDirect(url) {
  const v = (url || '').trim();
  if (!/1drv\.ms\/|onedrive\.live\.com\/|sharepoint\.com\//.test(v)) return null;
  let b64 = btoa(unescape(encodeURIComponent(v)))
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
}

/** Google Drive: pull the file id out of any of its share-link shapes.
    NOTE: Google throttles hotlinking and big files hit a scan interstitial —
    fine as a secondary source, not something to rely on at scale. */
export function googleDriveDirect(url) {
  const v = url || '';
  const m = v.match(/\/file\/d\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/);
  const id = m ? m[1] : null;
  if (!id) return null;
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

/** Generic: the link already points straight at the file (S3, R2, B2, …). */
export function directUrl(url) {
  const v = (url || '').trim();
  return /^https:\/\/\S+$/i.test(v) ? v : null;
}
