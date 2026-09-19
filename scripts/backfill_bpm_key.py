#!/usr/bin/env python3
"""
Backfills BPM + musical key onto data/catalog.json.

- Per source song (sourceSongs[].bpm / .key): looked up by artist+title via
  the GetSongBPM API, cached so a song reused across multiple mashups only
  costs one API call.
- Per mashup (top-level track.tempo / .key): no API knows what tempo/key
  YOU mixed at, so this downloads the mashup's own audio briefly from
  pCloud, runs beat-tracking + chroma-based key estimation on it with
  librosa, then deletes the temp file.

Idempotent: anything that already has bpm/key/tempo/key set is left alone,
so this is safe to re-run (e.g. as new tracks get added) without redoing
the whole catalog every time.

Env:
  GETSONGBPM_API_KEY   required for source-song lookups

Args:
  --limit N       stop after TOUCHING N tracks (default: no limit, all
                   tracks needing work get processed)
  --skip-audio    skip the pCloud download + librosa analysis step
                   (source-song lookups only — much faster)
"""
import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "catalog.json")
API_KEY = os.environ.get("GETSONGBPM_API_KEY", "")
API_BASE = "https://api.getsong.co"
UA = "bringmethemashup-backfill/1.0"


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


_song_cache = {}


def lookup_song(artist, title):
    """Returns {'bpm': int, 'key': str} or None. Cached per artist+title."""
    cache_key = (artist.strip().lower(), title.strip().lower())
    if cache_key in _song_cache:
        return _song_cache[cache_key]

    result = None
    try:
        lookup = f"song:{title} artist:{artist}"
        url = (
            f"{API_BASE}/search/?"
            + urllib.parse.urlencode({"api_key": API_KEY, "type": "both", "lookup": lookup, "limit": 1})
        )
        data = _get_json(url)
        songs = data.get("search") or []
        if songs and isinstance(songs, list):
            s = songs[0]
            bpm = s.get("tempo")
            key_of = s.get("key_of")
            result = {}
            if bpm:
                try:
                    result["bpm"] = int(round(float(bpm)))
                except (TypeError, ValueError):
                    pass
            if key_of:
                result["key"] = key_of
            if not result:
                result = None
    except Exception as e:
        print(f"  ! GetSongBPM lookup failed for {artist!r} - {title!r}: {e}", file=sys.stderr)

    _song_cache[cache_key] = result
    time.sleep(0.3)  # polite pacing; nowhere near the 3000/hr cap either way
    return result


def resolve_pcloud_url(public_link):
    """pCloud publink share URL -> a direct, short-lived download URL."""
    m = re.search(r"[?&]code=([A-Za-z0-9]+)", public_link or "")
    if not m:
        return None
    code = m.group(1)
    for host in ("api.pcloud.com", "eapi.pcloud.com"):
        try:
            data = _get_json(f"https://{host}/getpublinkdownload?code={code}")
            if data.get("result") == 0 and data.get("hosts") and data.get("path"):
                return f"https://{data['hosts'][0]}{data['path']}"
        except Exception:
            continue
    return None


PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl-Kessler key profiles (standard chroma-correlation key finding)
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def detect_tempo_key(path):
    import numpy as np
    import librosa

    y, sr = librosa.load(path, sr=22050, mono=True, duration=210)  # first 3.5 min is plenty
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(tempo.item() if hasattr(tempo, "item") else tempo)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    total = chroma_mean.sum()
    if total:
        chroma_mean = chroma_mean / total

    major = np.array(MAJOR_PROFILE)
    minor = np.array(MINOR_PROFILE)
    best = None
    for shift in range(12):
        maj_corr = np.corrcoef(chroma_mean, np.roll(major, shift))[0, 1]
        min_corr = np.corrcoef(chroma_mean, np.roll(minor, shift))[0, 1]
        for corr, mode in ((maj_corr, "major"), (min_corr, "minor")):
            if best is None or corr > best[0]:
                best = (corr, shift, mode)
    _, shift, mode = best
    key_name = PITCH_CLASSES[shift] + ("m" if mode == "minor" else "")
    return round(tempo), key_name


def analyze_track_audio(track):
    audio = track.get("audio") or {}
    if audio.get("type") != "pcloud" or not audio.get("publicLink"):
        return None
    url = resolve_pcloud_url(audio["publicLink"])
    if not url:
        return None
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        urllib.request.urlretrieve(url, tmp_path)
        tempo, key_name = detect_tempo_key(tmp_path)
        return {"tempo": tempo, "key": key_name}
    except Exception as e:
        print(f"  ! audio analysis failed for {track.get('id')}: {e}", file=sys.stderr)
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="stop after touching N tracks")
    ap.add_argument("--skip-audio", action="store_true", help="skip pCloud download + librosa analysis")
    args = ap.parse_args()

    if not API_KEY:
        print("GETSONGBPM_API_KEY is not set", file=sys.stderr)
        sys.exit(1)

    with open(CATALOG, encoding="utf-8") as f:
        tracks = json.load(f)

    touched = 0
    song_lookups = 0
    audio_analyzed = 0

    for t in tracks:
        if args.limit is not None and touched >= args.limit:
            break
        did_something = False

        for s in t.get("sourceSongs", []):
            if s.get("bpm") or s.get("key"):
                continue
            if not s.get("artist") or not s.get("title"):
                continue
            hit = lookup_song(s["artist"], s["title"])
            song_lookups += 1
            if hit:
                if hit.get("bpm") and not s.get("bpm"):
                    s["bpm"] = hit["bpm"]
                    did_something = True
                if hit.get("key") and not s.get("key"):
                    s["key"] = hit["key"]
                    did_something = True

        if not args.skip_audio and not (t.get("tempo") and t.get("key")):
            hit = analyze_track_audio(t)
            if hit:
                audio_analyzed += 1
                if hit.get("tempo") and not t.get("tempo"):
                    t["tempo"] = hit["tempo"]
                    did_something = True
                if hit.get("key") and not t.get("key"):
                    t["key"] = hit["key"]
                    did_something = True

        if did_something:
            touched += 1
            print(f"  updated {t.get('id')}")

    with open(CATALOG, "w", encoding="utf-8") as f:
        json.dump(tracks, f, indent=1, ensure_ascii=False)

    print(f"Done. tracks_touched={touched} song_lookups={song_lookups} audio_analyzed={audio_analyzed}")


if __name__ == "__main__":
    main()
