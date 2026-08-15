#!/usr/bin/env python3
"""
Convert a scrollmapper-format JSON Bible into the compact local format used by local.go.

Source: https://github.com/scrollmapper/bible_databases JSON exports (e.g. bbe.json, mkjv.json)
Shape:  {"translation": "...", "books": [{"name": "Genesis",
          "chapters": [{"chapter": 1, "verses": [{"verse": 1, "text": "..."}]}]}]}
Output: {USFM_BOOK: {chapter: {verse: text}}}  (compact JSON, next to this script)

Books are mapped by array index (canonical order), NOT by name — some exports
name the last book "Revelation of John".

Usage: python3 convert_scrollmapper.py <path-to-source.json> <output_filename>
"""
import json, os, re, sys

# canonical book index (0-65) -> USFM id (matches api.bible book IDs)
USFM = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
        "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
        "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
        "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
        "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
        "2PE","1JN","2JN","3JN","JUD","REV"]

HERE = os.path.dirname(os.path.abspath(__file__))


def clean(text):
    # MKJV marks supplied words with {braces}; they would render literally on the
    # LED wall, so unwrap them first. BBE has none, so this is safe unconditionally.
    t = re.sub(r"\{([^{}]*)\}", r"\1", text)
    return re.sub(r"\s+", " ", t).strip()


def convert(src_path, out_path):
    books = json.load(open(src_path, encoding="utf-8"))["books"]
    if len(books) != 66:
        sys.exit(f"error: expected 66 books in {src_path}, found {len(books)}")

    out = {}
    total = 0
    for i, book in enumerate(books):
        usfm = USFM[i]
        for chapter in book["chapters"]:
            cnum = str(int(chapter["chapter"]))
            for verse in chapter["verses"]:
                vnum = str(int(verse["verse"]))
                out.setdefault(usfm, {}).setdefault(cnum, {})[vnum] = clean(verse["text"])
                total += 1

    if len(out) != 66:
        sys.exit(f"error: expected 66 books in {src_path}, found {len(out)}")

    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.basename(out_path)}: {len(out)} books, {total} verses, {os.path.getsize(out_path)} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: python3 convert_scrollmapper.py <path-to-source.json> <output_filename>")
    convert(sys.argv[1], os.path.join(HERE, sys.argv[2]))
