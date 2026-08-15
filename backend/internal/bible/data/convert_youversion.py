#!/usr/bin/env python3
"""
Convert a laisiangtho/YouVersion-format JSON Bible into the compact local format
used by local.go.

Source: https://github.com/laisiangtho/... YouVersion-shaped exports (e.g. ceb.json)
Shape:  {"info": {...}, "book": {"1": {"info": {"name": "Genesis"},
          "chapter": {"1": {"verse": {"1": {"text": "..."}}}}}}}
Output: {USFM_BOOK: {chapter: {verse: text}}}  (compact JSON, next to this script)

Book numbers run 1-84; only 1-66 are the Protestant canon (67+ are apocrypha and
are skipped). Book number N maps to USFM[N-1].

Usage: python3 convert_youversion.py <path-to-source.json> [output_filename]
"""
import json, os, re, sys

# YouVersion book number (1-66) -> USFM id (matches api.bible book IDs)
USFM = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
        "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
        "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
        "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
        "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
        "2PE","1JN","2JN","3JN","JUD","REV"]

HERE = os.path.dirname(os.path.abspath(__file__))


def convert(src_path, out_path):
    books = json.load(open(src_path, encoding="utf-8"))["book"]
    out = {}
    total = 0
    for key, book in books.items():
        book_num = int(key)
        if book_num < 1:
            sys.exit(f"error: book number {book_num} out of range in {src_path}")
        if book_num > 66:
            continue  # apocrypha (67-84)
        usfm = USFM[book_num - 1]
        for ckey, chapter in book["chapter"].items():
            cnum = str(int(ckey))
            for vkey, verse in chapter["verse"].items():
                text = re.sub(r"\s+", " ", verse["text"]).strip()
                if not text:
                    continue
                out.setdefault(usfm, {}).setdefault(cnum, {})[str(int(vkey))] = text
                total += 1

    if len(out) != 66:
        sys.exit(f"error: expected 66 books in {src_path}, found {len(out)}")

    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.basename(out_path)}: {len(out)} books, {total} verses, {os.path.getsize(out_path)} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python3 convert_youversion.py <path-to-source.json> [output_filename]")
    name = sys.argv[2] if len(sys.argv) > 2 else "ceb.json"
    convert(sys.argv[1], os.path.join(HERE, name))
