#!/usr/bin/env python3
"""Fetch Sparkle delta bases and bounded appcast history for one desktop channel.

The upstream composite Action (electron-sparkle-updater/action@v1) cannot serve
Cradle's channels:

- it lists releases with --exclude-pre-releases, but every dev feed release is a
  prerelease and the bleeding-edge rolling feed is too, so no base is ever found
- it derives the archive suffix from the zip filename; release-channel zips are
  Cradle-x.y.z-mac-arm64.zip while CFBundleVersion is the monotonic run number,
  which is absent from that filename, so the suffix degenerates to ".zip" and the
  scan errors out with "ambiguous delta base archives" on any release that also
  ships the Windows zip
- it requires exactly one zip in the archive dir before it runs, so bases cannot
  be pre-populated ahead of the Action either

This script performs the equivalent fetch ourselves, channel-aware: it lists all
releases (prereleases included), picks the newest tags matching the channel's tag
prefix, downloads their appcast.xml into history/ subdirectories newest-first and
their mac zip into the archive directory as delta bases. Cradle then invokes the
vendored generate_appcast/appcast-history merge directly instead of the Action.
"""
import argparse
import json
import plistlib
import re
import subprocess
import sys
import zipfile
from pathlib import Path

SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
S = "{" + SPARKLE + "}"

# mac zips carry the desktop version in their name; CFBundleVersion is the
# monotonic workflow run number that ends dev/be versions. Release-channel zips
# (Cradle-x.y.z-mac-arm64.zip) carry no run number and always sort below any
# dev/be zip of the same release — irrelevant in practice because tag prefixes
# never mix channels, the ranking only matters within bleeding-edge feed assets
# that accumulate multiple builds.
RUN_IN_VERSION = re.compile(r"(?:^|[.-])(\d+)-mac-(arm64|x64)\.zip$")
MAC_ZIP = re.compile(r"^Cradle-.+-mac-(arm64|x64)\.zip$")


def gh_json(fields, *args):
    return json.loads(subprocess.check_output(["gh", *args, "--json", fields], text=True))


def run_number(name):
    match = RUN_IN_VERSION.search(name)
    return int(match.group(1)) if match else -1


def archive_version(path):
    with zipfile.ZipFile(path) as archive:
        entries = [entry for entry in archive.infolist()
                   if len(entry.filename.split("/")) == 3
                   and entry.filename.split("/")[0].endswith(".app")
                   and entry.filename.endswith("/Contents/Info.plist")]
        if len(entries) != 1 or entries[0].file_size > 2 * 1024 * 1024:
            raise ValueError("expected one top-level .app/Contents/Info.plist")
        value = plistlib.loads(archive.read(entries[0])).get("CFBundleVersion")
    if not isinstance(value, str) or not value or any(c in value for c in "\r\n,"):
        raise ValueError("invalid CFBundleVersion")
    return value


def sparkle_item_version(item):
    enclosure = item.find("enclosure")
    return item.findtext(S + "version") or (enclosure.get(S + "version") if enclosure is not None else None)


def item_versions(path):
    import xml.etree.ElementTree as ET
    root = ET.fromstring(Path(path).read_bytes())
    return {v for v in (sparkle_item_version(i) for i in root.findall("./channel/item")) if v}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--tag", required=True,
                        help="the release tag being built now; excluded from bases. Rolling-feed "
                             "channels pass their versioned tag here — the feed tag itself must NOT "
                             "be excluded because it is the only place prior builds live")
    parser.add_argument("--tag-prefix", required=True)
    parser.add_argument("--archive-dir", required=True)
    parser.add_argument("--bases", type=int, default=2)
    parser.add_argument("--history", type=int, default=6)
    args = parser.parse_args()
    if not 0 <= args.bases <= 32 or not 0 <= args.history <= 32:
        parser.error("--bases/--history must be 0-32")

    directory = Path(args.archive_dir)
    history_dir = directory / "history"
    history_dir.mkdir(parents=True, exist_ok=True)

    # Every release channel prefix must be free of overlap: dev-* never matches v*,
    # and feed-bleeding-edge is a literal single-tag prefix by construction. For
    # rolling-feed channels the tag under --tag is the versioned tag that never
    # exists as a release, so excluding it is a no-op while the feed tag survives
    # the filter — that is exactly what makes bleeding-edge bases resolvable.
    output = subprocess.check_output(
        ["gh", "release", "list", "--repo", args.repo, "--exclude-drafts",
         "--limit", "100", "--json", "tagName,publishedAt"], text=True)
    releases = sorted(
        (r for r in json.loads(output)
         if r["tagName"].startswith(args.tag_prefix) and r["tagName"] != args.tag),
        key=lambda r: r["publishedAt"], reverse=True)[:max(args.history, args.bases)]

    if not releases:
        print(f"fetch-sparkle-delta-bases: no prior '{args.tag_prefix}' releases; full-only appcast")
        return

    base_count = 0
    history_count = 0
    seen_versions = set()
    for index, release in enumerate(releases):
        tag = release["tagName"]
        assets = gh_json("assets", "release", "view", tag, "--repo", args.repo)["assets"]

        if index < args.history and history_count < args.history:
            if any(a["name"] == "appcast.xml" for a in assets):
                folder = history_dir / f"{index:02d}"
                folder.mkdir(exist_ok=True)
                subprocess.run(["gh", "release", "download", tag, "--repo", args.repo,
                                "--pattern", "appcast.xml", "--dir", str(folder),
                                "--clobber"], check=True)
                seen_versions.update(item_versions(folder / "appcast.xml"))
                history_count += 1
                print(f"fetch-sparkle-delta-bases: history <- {tag}")

        if index < args.bases and base_count < args.bases:
            # Rolling feeds accumulate multiple builds' zips on a single tag, so the
            # base budget is spent within that tag newest-first; versioned releases
            # carry exactly one mac zip per tag and the budget spans tags instead.
            candidates = [a["name"] for a in assets if MAC_ZIP.match(a["name"])]
            candidates.sort(key=run_number, reverse=True)
            for candidate in candidates:
                if base_count >= args.bases:
                    break
                subprocess.run(["gh", "release", "download", tag, "--repo", args.repo,
                                "--pattern", candidate, "--dir", str(directory),
                                "--clobber"], check=True)
                base_count += 1
                print(f"fetch-sparkle-delta-bases: delta base <- {tag}:{candidate}")

    downloaded = [p for p in directory.glob("*.zip")]
    # Sanity: deltas are only generated between archives generate_appcast can
    # order by CFBundleVersion. Read one to fail fast on corrupt downloads.
    for zip_path in downloaded:
        archive_version(zip_path)
    print(f"fetch-sparkle-delta-bases: {base_count} base zip(s), {history_count} history appcast(s), "
          f"{len(seen_versions)} known historical versions")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, json.JSONDecodeError, OSError, subprocess.CalledProcessError) as error:
        print(f"fetch-sparkle-delta-bases: {error}", file=sys.stderr)
        sys.exit(1)
