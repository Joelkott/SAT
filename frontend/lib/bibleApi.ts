import axios from 'axios';

const BIBLE_API_BASE = 'https://bible.helloao.org/api';

const bibleApi = axios.create({
  baseURL: BIBLE_API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

export interface BibleTranslation {
  id: string;
  name: string;
  language: string;
  englishName: string;
}

export interface BibleBook {
  id: string;
  name: string;
  numberOfChapters: number;
}

export interface BibleVerseContent {
  type: string;
  number?: number;
  content?: any[];
}

export interface BibleChapterResponse {
  translation: any;
  book: any;
  chapter: {
    number: number;
    content: BibleVerseContent[];
  };
}

export interface BibleVerse {
  verse: number;
  text: string;
}

export interface BibleChapter {
  translation: string;
  book: string;
  chapter: number;
  verses: BibleVerse[];
}

export const bibleApiClient = {
  // Get all available Bible translations
  getTranslations: async (): Promise<BibleTranslation[]> => {
    const response = await bibleApi.get<{ translations: BibleTranslation[] }>('/available_translations.json');
    return response.data.translations || [];
  },

  // Get all books for a specific translation
  getBooks: async (translation: string): Promise<BibleBook[]> => {
    const response = await bibleApi.get<{ books: BibleBook[] }>(`/${translation}/books.json`);
    return response.data.books || [];
  },

  // Get a specific chapter
  getChapter: async (translation: string, book: string, chapter: number): Promise<BibleChapter> => {
    const response = await bibleApi.get<BibleChapterResponse>(`/${translation}/${book}/${chapter}.json`);

    // Parse the response to extract verses
    const verses: BibleVerse[] = [];

    if (response.data.chapter && response.data.chapter.content) {
      response.data.chapter.content.forEach((item) => {
        if (item.type === 'verse' && item.number && item.content) {
          // Extract text from content array (which can contain strings and objects)
          const text = item.content
            .filter((c: any) => typeof c === 'string')
            .join(' ')
            .trim();

          if (text) {
            verses.push({
              verse: item.number,
              text: text,
            });
          }
        }
      });
    }

    return {
      translation: translation,
      book: book,
      chapter: chapter,
      verses: verses,
    };
  },
};

export default bibleApiClient;
