package versedetect

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/yourusername/audience-stage-teleprompter/internal/versedetect/jev"
)

// fakeAsker returns scripted answers per round and records the question ids asked.
type fakeAsker struct {
	rounds []map[string]jev.Answer
	err    error
	asked  [][]string
	lastQs []map[string]jev.Question
	states []any
}

func (f *fakeAsker) Ask(ctx context.Context, state any, qs map[string]jev.Question) (*jev.Response, error) {
	ids := make([]string, 0, len(qs))
	for id := range qs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	f.asked = append(f.asked, ids)
	f.lastQs = append(f.lastQs, qs)
	f.states = append(f.states, state)
	if f.err != nil {
		return nil, f.err
	}
	i := len(f.asked) - 1
	if i >= len(f.rounds) {
		return &jev.Response{Answers: map[string]jev.Answer{}}, nil
	}
	return &jev.Response{Answers: f.rounds[i]}, nil
}

func noul(p float64) jev.Answer { return jev.Answer{Type: "noul", Noul: p} }
func choice(c string, p float64) jev.Answer {
	return jev.Answer{Type: "choice", Choice: c, Probabilities: map[string]float64{c: p}, Confidence: p}
}

func always() bool { return true }

func testState() jevState {
	return jevState{Task: jevTask, LatestCaption: "and the very next verse says", CurrentPassage: "none"}
}

func TestJevRound1SameAsCurrent(t *testing.T) {
	cur := &Ref{Book: "ROM", Chapter: 8, Verse: 28}
	f := &fakeAsker{rounds: []map[string]jev.Answer{{
		"cites":      noul(0.95),
		"book":       choice("same_as_current", 0.9),
		"verse_here": choice("29", 0.92),
	}}}
	res, err := resolveWithJev(context.Background(), f, testState(), cur, kjv(), 0.8, always)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Found || res.Ref != (Ref{Book: "ROM", Chapter: 8, Verse: 29}) {
		t.Fatalf("got %+v", res)
	}
	if res.Confidence != 0.9 || res.Rounds != 1 {
		t.Fatalf("conf %v rounds %d", res.Confidence, res.Rounds)
	}
}

func TestJevRound1Gates(t *testing.T) {
	cur := &Ref{Book: "ROM", Chapter: 8, Verse: 28}
	cases := []struct {
		name string
		ans  map[string]jev.Answer
	}{
		{"cites low", map[string]jev.Answer{"cites": noul(0.6), "book": choice("same_as_current", 0.9), "verse_here": choice("29", 0.92)}},
		{"book none", map[string]jev.Answer{"cites": noul(0.95), "book": choice("none", 0.95), "verse_here": choice("29", 0.92)}},
		{"book low", map[string]jev.Answer{"cites": noul(0.95), "book": choice("same_as_current", 0.7), "verse_here": choice("29", 0.92)}},
		{"missing answers", map[string]jev.Answer{"cites": noul(0.95)}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeAsker{rounds: []map[string]jev.Answer{c.ans}}
			res, err := resolveWithJev(context.Background(), f, testState(), cur, kjv(), 0.8, always)
			if err != nil {
				t.Fatal(err)
			}
			if res.Found || res.ContextOnly || res.Rounds != 1 {
				t.Fatalf("got %+v", res)
			}
		})
	}
}

func TestJevThreeRoundsNewBook(t *testing.T) {
	f := &fakeAsker{rounds: []map[string]jev.Answer{
		{"cites": noul(0.9), "book": choice("PHP", 0.95)},
		{"chapter": choice("4", 0.9)},
		{"verse": choice("13", 0.88)},
	}}
	res, err := resolveWithJev(context.Background(), f, testState(), nil, kjv(), 0.8, always)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Found || res.Ref != (Ref{Book: "PHP", Chapter: 4, Verse: 13}) || res.Confidence != 0.88 || res.Rounds != 3 {
		t.Fatalf("got %+v", res)
	}
	if len(f.asked) > 3 {
		t.Fatalf("more than 3 asks: %v", f.asked)
	}
	if strings.Join(f.asked[0], ",") != "book,cites" {
		t.Fatalf("round 1 ids %v", f.asked[0])
	}
	if strings.Join(f.asked[1], ",") != "chapter" || strings.Join(f.asked[2], ",") != "verse" {
		t.Fatalf("round ids %v", f.asked)
	}
	ch := f.lastQs[1]["chapter"].Criteria
	if len(ch) != 5 || ch["none"] == "" || ch["1"] == "" || ch["4"] == "" {
		t.Fatalf("chapter criteria %v", ch)
	}
	vs := f.lastQs[2]["verse"].Criteria
	if len(vs) != 24 || vs["whole_chapter"] == "" || vs["1"] == "" || vs["23"] == "" {
		t.Fatalf("verse criteria has %d keys", len(vs))
	}
}

func TestJevSingleChapterBookSkipsChapterRound(t *testing.T) {
	f := &fakeAsker{rounds: []map[string]jev.Answer{
		{"cites": noul(0.9), "book": choice("JUD", 0.95)},
		{"verse": choice("5", 0.9)},
	}}
	res, err := resolveWithJev(context.Background(), f, testState(), nil, kjv(), 0.8, always)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Found || res.Ref != (Ref{Book: "JUD", Chapter: 1, Verse: 5}) || res.Rounds != 2 {
		t.Fatalf("got %+v", res)
	}
}

func TestJevWholeChapterIsContextOnly(t *testing.T) {
	f := &fakeAsker{rounds: []map[string]jev.Answer{
		{"cites": noul(0.9), "book": choice("PHP", 0.95)},
		{"chapter": choice("4", 0.9)},
		{"verse": choice("whole_chapter", 0.9)},
	}}
	res, err := resolveWithJev(context.Background(), f, testState(), nil, kjv(), 0.8, always)
	if err != nil {
		t.Fatal(err)
	}
	if res.Found || !res.ContextOnly || res.Ref != (Ref{Book: "PHP", Chapter: 4}) || res.Rounds != 3 {
		t.Fatalf("got %+v", res)
	}
}

func TestJevBudgetStops(t *testing.T) {
	f := &fakeAsker{rounds: []map[string]jev.Answer{
		{"cites": noul(0.9), "book": choice("PHP", 0.95)},
		{"chapter": choice("4", 0.9)},
	}}
	calls := 0
	budget := func() bool { calls++; return calls == 1 }
	res, err := resolveWithJev(context.Background(), f, testState(), nil, kjv(), 0.8, budget)
	if err != nil {
		t.Fatal(err)
	}
	if res.Found || res.Rounds != 1 || len(f.asked) != 1 {
		t.Fatalf("got %+v asked %v", res, f.asked)
	}
}

func TestJevAskerError(t *testing.T) {
	f := &fakeAsker{err: errors.New("boom")}
	res, err := resolveWithJev(context.Background(), f, testState(), nil, kjv(), 0.8, always)
	if err == nil || res.Found {
		t.Fatalf("want error, got %+v %v", res, err)
	}
}

func TestQuestionRound1NoContext(t *testing.T) {
	qs := buildRound1(nil, kjv())
	if _, ok := qs["verse_here"]; ok {
		t.Fatal("verse_here asked without context")
	}
	book := qs["book"].Criteria
	if _, ok := book["same_as_current"]; ok {
		t.Fatal("same_as_current offered without context")
	}
	if len(book) != 67 || book["none"] == "" || book["JHN"] == "" || book["REV"] == "" {
		t.Fatalf("book criteria has %d keys", len(book))
	}
	if qs["cites"].Type != "noul" || qs["book"].Type != "choice" {
		t.Fatalf("types %v", qs)
	}
}

func TestQuestionRound1WithContext(t *testing.T) {
	qs := buildRound1(&Ref{Book: "JHN", Chapter: 3, Verse: 16}, kjv())
	book := qs["book"].Criteria
	if len(book) != 68 || book["same_as_current"] == "" {
		t.Fatalf("book criteria has %d keys", len(book))
	}
	vh, ok := qs["verse_here"]
	if !ok {
		t.Fatal("no verse_here")
	}
	if len(vh.Criteria) != 37 || vh.Criteria["none"] == "" || vh.Criteria["36"] == "" {
		t.Fatalf("verse_here has %d keys", len(vh.Criteria))
	}
	for i := 1; i <= 36; i++ {
		if vh.Criteria[strconv.Itoa(i)] == "" {
			t.Fatalf("missing verse %d", i)
		}
	}
	for _, want := range []string{"John 3", "'the next verse' means 17", "'the previous verse' means 15"} {
		if !strings.Contains(vh.Instructions, want) {
			t.Errorf("instructions %q missing %q", vh.Instructions, want)
		}
	}
	if !strings.Contains(vh.Criteria["16"], "God so loved") {
		t.Errorf("verse 16 description %q", vh.Criteria["16"])
	}
}
