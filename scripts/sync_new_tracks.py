#!/usr/bin/env python3
"""
Monthly sync: pulls newly-approved tracks from the Supabase `tracks` table
(submitted live via submit.html) into data/catalog.json, which is the file
the static site and the BPM/key backfill script both read from.

Why this exists: submit.html writes straight to Supabase. Nothing else was
copying those rows back into catalog.json, so tracks uploaded after the
site launched (2026-07) sat in the database but never showed up in the
committed catalog or got BPM/key data. This closes that gap automatically.

Uses the site's own public anon key (same one already shipped in
js/config.js, safe to embed) since the `tracks` table's RLS policy lets the
public read approved rows.

Idempotent: only appends ids not already in catalog.json.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "catalog.json")

SUPABASE_URL = "https://txkmwsnvtwobhrdrablw.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6"
    "InR4a213c252dHdvYmhyZHJhYmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwOTY0"
    "MjQsImV4cCI6MjA5ODY3MjQyNH0.S4gQFyfNUhcUbIh5vBaNEj3VxQONTYcuc9VaSCxN74c"
)


def fetch_approved_tracks():
    """Paginate through the tracks table's public (approved) rows."""
    tracks = []
    page_size = 500
    offset = 0
    while True:
        url = (
            f"{SUPABASE_URL}/rest/v1/tracks"
            f"?select=id,data,created_at&status=eq.approved&order=created_at.asc"
            f"&limit={page_size}&offset={offset}"
        )
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            batch = json.load(r)
        tracks.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return tracks


def main():
    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)
    existing_ids = {t["id"] for t in catalog}

    try:
        rows = fetch_approved_tracks()
    except Exception as e:
        print(f"Failed to fetch tracks from Supabase: {e}", file=sys.stderr)
        sys.exit(1)

    added = 0
    for row in rows:
        rid = row.get("id")
        if not rid or rid in existing_ids:
            continue
        entry = row.get("data") or {}
        entry["id"] = rid
        if not entry.get("dateAdded") and row.get("created_at"):
            entry["dateAdded"] = row["created_at"][:10]
        catalog.append(entry)
        existing_ids.add(rid)
        added += 1
        print(f"  added {rid}")

    if added:
        with open(CATALOG, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=1, ensure_ascii=False)

    print(f"Done. fetched={len(rows)} added={added} catalog_total={len(catalog)}")


if __name__ == "__main__":
    main()
