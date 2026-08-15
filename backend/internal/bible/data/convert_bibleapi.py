#!/usr/bin/env python3
"""
Convert a bibleapi resultset JSON Bible into the compact local format used by local.go.

Source: https://github.com/bibleapi/bibleapi-bibles-json (e.g. asv.json)
Shape:  {"resultset": {"row": [{"field": [verseId, bookNum, chapter, verse, "text"]}, ...]}}
Output: {USFM_BOOK: {chapter: {verse: text}}}  (compact JSON, next to this script)

Usage: python3 convert_bibleapi.py <path-to-bibleapi.json> [output_filename]
"""
import json, os, re, sys

# bibleapi book number (1-66) -> USFM id (matches api.bible book IDs)
USFM = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
        "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
        "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
        "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
        "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
        "2PE","1JN","2JN","3JN","JUD","REV"]

HERE = os.path.dirname(os.path.abspath(__file__))


def convert(src_path, out_path):
    rows = json.load(open(src_path, encoding="utf-8"))["resultset"]["row"]
    out = {}
    total = 0
    for row in rows:
        _, book_num, chapter, verse, text = row["field"][:5]
        book_num = int(book_num)
        if not 1 <= book_num <= 66:
            sys.exit(f"error: book number {book_num} out of range 1-66 in {src_path}")
        usfm = USFM[book_num - 1]
        out.setdefault(usfm, {}).setdefault(str(int(chapter)), {})[str(int(verse))] = \
            re.sub(r"\s+", " ", text).strip()
        total += 1

    if len(out) != 66:
        sys.exit(f"error: expected 66 books in {src_path}, found {len(out)}")

    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.basename(out_path)}: {len(out)} books, {total} verses, {os.path.getsize(out_path)} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python3 convert_bibleapi.py <path-to-bibleapi.json> [output_filename]")
    name = sys.argv[2] if len(sys.argv) > 2 else "asv.json"
    convert(sys.argv[1], os.path.join(HERE, name))
