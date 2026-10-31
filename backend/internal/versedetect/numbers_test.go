package versedetect

import "testing"

func TestNormalizeNumbers(t *testing.T) {
	cases := []struct{ in, want string }{
		{"chapter eight verse twenty eight", "chapter 8 verse 28"},
		{"verse twenty-one", "verse 21"},
		{"psalm one hundred and nineteen verse one hundred and five", "psalm 119 verse 105"},
		{"a hundred and fifty", "150"},
		{"first corinthians thirteen", "1 corinthians 13"},
		{"second kings", "2 kings"},
		{"1st john", "1 john"},
		{"iii john", "3 john"},
		{"the first time", "the first time"},
		{"verse seventeen", "verse 17"},
		{"verses four and five", "verses 4 and 5"},
		{"a man went", "a man went"},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			if got := normalizeNumbers(c.in); got != c.want {
				t.Errorf("normalizeNumbers(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestMostlyNonLatin(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"ദൈവം ലോകത്തെ സ്നേഹിച്ചു", true},
		{"John 3:16 says", false},
		{"", false},
	}
	for _, c := range cases {
		if got := mostlyNonLatin(c.in); got != c.want {
			t.Errorf("mostlyNonLatin(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
