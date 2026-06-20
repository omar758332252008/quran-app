import { supabase } from "./supabase";

export type Surah = {
  id: number;
  number: number;
  nameArabic: string;
  nameEnglish: string;
  nameTranslation: string | null;
  revelationPlace: string | null;
  revelationOrder: number | null;
  versesCount: number;
  bismillahPre: boolean;
  startPage: number | null;
};

export type Ayah = {
  id: number;
  surahId: number;
  ayahNumber: number;
  verseKey: string;
  arabicText: string;
  transliteration: string | null;
  pageNumber: number | null;
};

// An ayah enriched with its surah's name/number - used when a Mushaf page
// spans more than one surah.
export type PageAyah = Ayah & {
  surahNumber: number;
  surahNameArabic: string;
  surahBismillahPre: boolean;
};

// Raw row shapes as returned by Supabase (snake_case columns)
type SurahRow = {
  id: number;
  number: number;
  name_arabic: string;
  name_english: string;
  name_translation: string | null;
  revelation_place: string | null;
  revelation_order: number | null;
  verses_count: number;
  bismillah_pre: boolean;
  start_page: number | null;
};

type AyahRow = {
  id: number;
  surah_id: number;
  ayah_number: number;
  verse_key: string;
  arabic_text: string;
  transliteration: string | null;
  page_number: number | null;
};

export const TOTAL_MUSHAF_PAGES = 604;

function mapSurah(row: SurahRow): Surah {
  return {
    id: row.id,
    number: row.number,
    nameArabic: row.name_arabic,
    nameEnglish: row.name_english,
    nameTranslation: row.name_translation,
    revelationPlace: row.revelation_place,
    revelationOrder: row.revelation_order,
    versesCount: row.verses_count,
    bismillahPre: row.bismillah_pre,
    startPage: row.start_page,
  };
}

function mapAyah(row: AyahRow): Ayah {
  return {
    id: row.id,
    surahId: row.surah_id,
    ayahNumber: row.ayah_number,
    verseKey: row.verse_key,
    arabicText: row.arabic_text,
    transliteration: row.transliteration,
    pageNumber: row.page_number,
  };
}

// Get all 114 surahs ordered by number
export async function fetchSurahs(): Promise<Surah[]> {
  const { data, error } = await supabase
    .from("surahs")
    .select("*")
    .order("number", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapSurah);
}

// Get a surah with all of its ayahs, by surah number (1-114)
export async function fetchSurahWithAyahs(
  surahNumber: number
): Promise<{ surah: Surah; ayahs: Ayah[] }> {
  const { data: surahRow, error: surahError } = await supabase
    .from("surahs")
    .select("*")
    .eq("number", surahNumber)
    .single();

  if (surahError) throw new Error(surahError.message);

  const { data: ayahRows, error: ayahError } = await supabase
    .from("ayahs")
    .select("*")
    .eq("surah_id", surahRow.id)
    .order("ayah_number", { ascending: true });

  if (ayahError) throw new Error(ayahError.message);

  return {
    surah: mapSurah(surahRow),
    ayahs: (ayahRows ?? []).map(mapAyah),
  };
}

// Get every ayah that falls on a given Mushaf page (1-604), each tagged
// with its surah name/number since a page can span two surahs.
export async function fetchPageAyahs(pageNumber: number): Promise<PageAyah[]> {
  const { data, error } = await supabase
    .from("ayahs")
    .select("*, surahs(number, name_arabic, bismillah_pre)")
    .eq("page_number", pageNumber)
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    ...mapAyah(row),
    surahNumber: row.surahs.number,
    surahNameArabic: row.surahs.name_arabic,
    surahBismillahPre: row.surahs.bismillah_pre,
  }));
}

// --- Mushaf line layout -----------------------------------------------
// The Madani Mushaf prints each of its 604 pages across a fixed number of
// justified lines, and where a line breaks is part of what makes a page
// visually recognizable. Our own ayah text doesn't carry that information,
// so we pull it from the free public Quran.com API (no key required),
// which tags every word of every ayah with the printed line number it
// falls on for the standard 604-page Hafs Mushaf.
export type PageLineLayout = {
  totalLines: number;
  // verseKey ("2:255") -> line number for each word of that ayah, in order
  wordLinesByVerseKey: Record<string, number[]>;
};

export async function fetchPageLineLayout(pageNumber: number): Promise<PageLineLayout> {
  const res = await fetch(
    `https://api.quran.com/api/v4/verses/by_page/${pageNumber}?words=true&word_fields=line_number&fields=text_uthmani`
  );
  if (!res.ok) throw new Error("فشل تحميل تخطيط أسطر الصفحة");

  const json = await res.json();
  const wordLinesByVerseKey: Record<string, number[]> = {};
  let totalLines = 0;

  for (const verse of json.verses ?? []) {
    const lines: number[] = [];
    for (const word of verse.words ?? []) {
      // Skip the decorative end-of-ayah ornament glyph the API returns as
      // a pseudo "word" - we render our own ayah-number marker instead.
      if (word.char_type_name !== "word") continue;
      lines.push(word.line_number);
      if (word.line_number > totalLines) totalLines = word.line_number;
    }
    wordLinesByVerseKey[verse.verse_key] = lines;
  }

  return { totalLines, wordLinesByVerseKey };
}
