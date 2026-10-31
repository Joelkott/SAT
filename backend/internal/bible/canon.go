package bible

import "strconv"

// canonBibleID is the bundled translation used to validate references
// (verse detection): the KJV versification.
const canonBibleID = "local-kjv"

func (lp *LocalProvider) canonBook(book string) map[string]map[string]string {
	lb, ok := lp.bibles[canonBibleID]
	if !ok {
		return nil
	}
	return lb.data[book]
}

// ChapterCount returns how many chapters the KJV has for a USFM book id (0 if unknown).
func (lp *LocalProvider) ChapterCount(book string) int {
	return len(lp.canonBook(book))
}

// VerseCount returns the highest verse number in book/chapter (0 if unknown).
func (lp *LocalProvider) VerseCount(book string, chapter int) int {
	verses := lp.canonBook(book)[strconv.Itoa(chapter)]
	max := 0
	for k := range verses {
		n, err := strconv.Atoi(k)
		if err != nil {
			continue
		}
		if n > max {
			max = n
		}
	}
	return max
}

// VerseText returns the KJV text of one verse ("" if absent).
func (lp *LocalProvider) VerseText(book string, chapter, verse int) string {
	return lp.canonBook(book)[strconv.Itoa(chapter)][strconv.Itoa(verse)]
}
