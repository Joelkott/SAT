#!/usr/bin/env python3
"""
Generate compact local Bible data from getbible.net full-file exports.

Source: https://api.getbible.net/v2/{mal1910,kjv}.json  (both public domain)
Output: mal_ov_1910.json, kjv.json  -- compact {USFM_BOOK: {chapter: {verse: text}}}

Run from anywhere; writes next to this script. Re-run to refresh the bundled text.
Usage: python3 generate.py [dir_with_raw_files]
"""
import json, os, sys

# getbible book number (1-66) -> USFM id (matches api.bible book IDs)
USFM = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
        "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
        "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
        "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
        "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
        "2PE","1JN","2JN","3JN","JUD","REV"]

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = sys.argv[1] if len(sys.argv) > 1 else HERE

def transform(raw_path, out_path):
    d = json.load(open(raw_path, encoding="utf-8"))
    out = {}
    total = 0
    for book in d["books"]:
        nr = int(book["nr"])
        usfm = USFM[nr-1]
        chapters = {}
        for ch in book["chapters"]:
            cnum = str(ch["chapter"])
            verses = {}
            for v in ch["verses"]:
                verses[str(v["verse"])] = v["text"].strip()
                total += 1
            chapters[cnum] = verses
        out[usfm] = chapters
    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.basename(out_path)}: {len(out)} books, {total} verses, {os.path.getsize(out_path)} bytes")

transform(os.path.join(RAW, "mal1910_raw.json"), os.path.join(HERE, "mal_ov_1910.json"))
transform(os.path.join(RAW, "kjv_raw.json"),     os.path.join(HERE, "kjv.json"))
