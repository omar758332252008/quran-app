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

// --- Accurate Mushaf text + line layout --------------------------------
// Word text AND printed-line numbers both come from the same Quran.com
// API call (the standard text_uthmani script used by the official
// 604-page Madani Mushaf), so they're guaranteed to line up perfectly -
// unlike pulling text from one source and layout from another.
export type MushafWord = {
  text: string;
  line: number;
};

export type MushafAyah = {
  surahNumber: number;
  ayahNumber: number;
  verseKey: string;
  words: MushafWord[];
};

export type MushafPageData = {
  totalLines: number;
  ayahs: MushafAyah[];
};

export async function fetchMushafPage(pageNumber: number): Promise<MushafPageData> {
  const res = await fetch(
    `https://api.quran.com/api/v4/verses/by_page/${pageNumber}?words=true&word_fields=line_number,text_uthmani&fields=text_uthmani`
  );
  if (!res.ok) throw new Error("فشل تحميل نص الصفحة");

  const json = await res.json();
  let totalLines = 0;

  const ayahs: MushafAyah[] = (json.verses ?? []).map((verse: any) => {
    const [surahStr, ayahStr] = String(verse.verse_key).split(":");
    const words: MushafWord[] = (verse.words ?? [])
      .filter((w: any) => w.char_type_name === "word")
      .map((w: any) => {
        if (w.line_number > totalLines) totalLines = w.line_number;
        return { text: w.text_uthmani as string, line: w.line_number as number };
      });

    return {
      surahNumber: parseInt(surahStr, 10),
      ayahNumber: parseInt(ayahStr, 10),
      verseKey: verse.verse_key,
      words,
    };
  });

  return { totalLines, ayahs };
}
