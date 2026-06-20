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
