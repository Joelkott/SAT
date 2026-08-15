#!/usr/bin/env python3
"""
Convert a Zefania XML Bible into the compact local format used by local.go.

Source shape: XMLBIBLE > BIBLEBOOK[bnumber=1..66,bname] > CHAPTER[cnumber] > VERS[vnumber]
Output:       {USFM_BOOK: {chapter: {verse: text}}}  (compact JSON, next to this script)

Cross-reference brackets like "[Heb. 11:3.]" are stripped; amplification brackets
like "[to feed, guide, and shield me]" are preserved verbatim.

Usage: python3 convert_zefania.py <path-to-zefania.xml> [output_filename]
"""
import json, os, re, sys
import xml.etree.ElementTree as ET

# Zefania book number (1-66) -> USFM id (matches api.bible book IDs)
USFM = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
        "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
        "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
        "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
        "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
        "2PE","1JN","2JN","3JN","JUD","REV"]

HERE = os.path.dirname(os.path.abspath(__file__))

# A bracketed segment with no nested brackets.
BRACKET = re.compile(r"\[[^\[\]]*\]")

# Book names/abbreviations as they appear inside AMPC cross-reference brackets,
# without the numeral prefix ("II Sam.") or trailing period, which BOOK_RE adds.
# Matching is case-sensitive so ordinary words ("job") are never mistaken for books.
CITATION_BOOKS = [
    "S. of Sol", "Song of Solomon", "Song of Sol",
    "Gen", "Genesis", "Exod", "Exodus", "Ex", "Lev", "Leviticus", "Num", "Numbers",
    "Deut", "Deuteronomy", "Josh", "Joshua", "Judg", "Judges", "Ruth",
    "Sam", "Samuel", "Kings", "Kgs", "Chron", "Chronicles", "Ezra", "Neh",
    "Nehemiah", "Esther", "Esth", "Job", "Ps", "Pss", "Psalm", "Psalms",
    "Prov", "Proverbs", "Eccl", "Ecclesiastes", "Isa", "Isaiah", "Jer", "Jeremiah",
    "Lam", "Lamentations", "Ezek", "Ezekiel", "Dan", "Daniel", "Hos", "Hosea",
    "Joel", "Amos", "Obad", "Obadiah", "Jonah", "Mic", "Micah", "Nah", "Nahum",
    "Hab", "Habakkuk", "Zeph", "Zephaniah", "Hag", "Haggai", "Zech", "Zechariah",
    "Mal", "Malachi", "Matt", "Matthew", "Mark", "Luke", "John", "Acts",
    "Rom", "Romans", "Cor", "Corinthians", "Gal", "Galatians", "Eph", "Ephesians",
    "Phil", "Philippians", "Col", "Colossians", "Thess", "Thessalonians",
    "Tim", "Timothy", "Tit", "Titus", "Philem", "Philemon", "Heb", "Hebrews",
    "James", "Pet", "Peter", "Jude", "Rev", "Revelation", "Macc",
]
BOOK_RE = re.compile(
    r"\b(?:(?:[IVX]{1,3}|[123])\s*)?(?:"
    + "|".join(re.escape(b) for b in sorted(CITATION_BOOKS, key=len, reverse=True))
    + r")(?![A-Za-z])\.?"  # "Acts17:26" has no space, so a plain \b would miss it
)
# Editorial lead-ins that introduce a citation, allowed only at bracket start.
CONNECTIVE_RE = re.compile(
    r"^\s*(?:fulfilled in|foretold in|cited in|quoted in|see also|see|compare|cp\.?|cf\.?)\s+",
    re.IGNORECASE,
)
# Verse/chapter numbers, optionally with the "13c" / "10ff." qualifiers AMPC uses.
NUMBER_RE = re.compile(r"\d+[a-c]?(?:ff\.?)?")
SEPARATOR_RE = re.compile(r"[\s:;,.\-–—]")


def is_cross_reference(inner):
    """True when a bracket holds nothing but scripture citations.

    Strips a leading connective, every known book name, every verse number and
    every separator; if nothing is left (and at least one book + one digit were
    present) the bracket is a cross reference, not amplification. Amplification
    like "[to feed, guide, and shield me]" or "[between 3:00-6:00 a.m.]" always
    leaves residue and is preserved.
    """
    if not re.search(r"\d", inner):
        return False
    rest = CONNECTIVE_RE.sub("", inner)
    rest, books = BOOK_RE.subn("", rest)
    if books == 0:
        return False
    rest = NUMBER_RE.sub("", rest)
    return SEPARATOR_RE.sub("", rest) == ""


def clean(text):
    """Drop cross-reference brackets, keep amplification brackets, normalize space."""
    def drop_citations(m):
        return "" if is_cross_reference(m.group(0)[1:-1]) else m.group(0)

    t = BRACKET.sub(drop_citations, text)
    return re.sub(r"\s+", " ", t).strip()


def convert(xml_path, out_path):
    root = ET.parse(xml_path).getroot()
    books = root.findall(".//BIBLEBOOK")
    if len(books) != 66:
        sys.exit(f"error: expected 66 books in {xml_path}, found {len(books)}")

    out = {}
    total = 0
    for book in books:
        try:
            nr = int(book.get("bnumber"))
        except (TypeError, ValueError):
            sys.exit(f"error: BIBLEBOOK missing a numeric bnumber (bname={book.get('bname')!r})")
        if not 1 <= nr <= 66:
            sys.exit(f"error: bnumber {nr} out of range 1-66 (bname={book.get('bname')!r})")
        usfm = USFM[nr - 1]

        chapters = {}
        for ch in book.findall("CHAPTER"):
            cnum = str(int(ch.get("cnumber")))
            verses = {}
            for vers in ch.findall("VERS"):
                vnum = str(int(vers.get("vnumber")))
                verses[vnum] = clean("".join(vers.itertext()))
                total += 1
            chapters[cnum] = verses
        out[usfm] = chapters

    json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.basename(out_path)}: {len(out)} books, {total} verses, {os.path.getsize(out_path)} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().splitlines()[-1])
    src = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else "ampc.json"
    convert(src, os.path.join(HERE, name))
