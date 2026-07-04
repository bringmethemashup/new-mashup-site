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
  const mediaKind = entry.audio?.url ? 'upload'
    : entry.audio?.publicLink ? 'pcloud'
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
    </select>
  </div>
  <div class="f tf-file-f"><label>File (mp3, m4a, wav, ogg, mp4 — max 100 MB)</label>
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
    <input class="sr-artist" placeholder="Song artist" value="${esc(s.artist)}">
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
      if (lbl) lbl.textContent = v === 'youtube' ? 'YouTube video link'
        : v === 'tiktok' ? 'TikTok video link' : 'pCloud public link';
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
  }
  return { entry, file, mediaKind };
}

export function parseYouTubeId(url) {
  const m = (url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
  return m ? m[1] : null;
}
