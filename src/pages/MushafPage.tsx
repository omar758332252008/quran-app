import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMushafPage,
  fetchSurahs,
  TOTAL_MUSHAF_PAGES,
} from "@/lib/quran";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  MicOff,
  ChevronRight,
  ChevronLeft,
  Home as HomeIcon,
  RotateCcw,
} from "lucide-react";

type RecitationState = "idle" | "listening" | "completed";
type WordStatus = "upcoming" | "matched" | "missed";

const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

// Remove diacritics / normalize letter variants so the comparison focuses
// on the actual word, not on tashkeel that speech recognition never
// reproduces faithfully anyway.
function normalizeArabic(text: string): string {
  return text
    .replace(/[ًٌٍَُِّْٰ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u0640]/g, "")
    .trim();
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function toArabicNumerals(n: number): string {
  const digits = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(n)
    .split("")
    .map((d) => digits[Number(d)])
    .join("");
}

function wordsLooselyMatch(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a);
}

// Aligns what was actually heard against the page's word sequence.
// Unlike a strict word-by-word grader, this tolerates a missed or extra
// word here and there (very common with browser speech recognition on
// Quranic recitation) by looking a few words ahead before giving up on a
// match - so one misheard word doesn't throw off everything after it.
function alignRecitation(pageWords: string[], recognizedWords: string[]): WordStatus[] {
  const pageNorm = pageWords.map(normalizeArabic);
  const recNorm = recognizedWords.map(normalizeArabic);
  const statuses: WordStatus[] = pageNorm.map(() => "upcoming");

  let pageIdx = 0;
  let recIdx = 0;

  while (recIdx < recNorm.length && pageIdx < pageNorm.length) {
    if (wordsLooselyMatch(recNorm[recIdx], pageNorm[pageIdx])) {
      statuses[pageIdx] = "matched";
      pageIdx++;
      recIdx++;
      continue;
    }

    let skipFound = -1;
    for (let skip = 1; skip <= 3 && pageIdx + skip < pageNorm.length; skip++) {
      if (wordsLooselyMatch(recNorm[recIdx], pageNorm[pageIdx + skip])) {
        skipFound = skip;
        break;
      }
    }

    if (skipFound > 0) {
      for (let k = 0; k < skipFound; k++) statuses[pageIdx + k] = "missed";
      statuses[pageIdx + skipFound] = "matched";
      pageIdx += skipFound + 1;
      recIdx++;
    } else {
      // Likely an extra/misheard word from the recognizer - drop it and
      // keep trying with the next one instead of stalling the cursor.
      recIdx++;
    }
  }

  return statuses;
}

// A small original arabesque corner flourish, drawn from scratch with
// basic shapes - decorative framing for the page, not a copy of any real
// Mushaf print artwork.
function CornerOrnament({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={`h-7 w-7 sm:h-9 sm:w-9 text-amber-700/70 dark:text-amber-400/60 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M2 2 L2 14 Q2 2 14 2" />
      <circle cx="2" cy="2" r="2.4" fill="currentColor" stroke="none" />
      <path d="M6 2 Q16 2 16 12" />
      <path d="M2 6 Q2 16 12 16" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function MushafPage() {
  const { pageNumber: pageParam } = useParams<{ pageNumber: string }>();
  const navigate = useNavigate();
  const pageNumber = Math.min(Math.max(parseInt(pageParam || "1"), 1), TOTAL_MUSHAF_PAGES);

  // Word text AND printed-line numbers both come from the official
  // Quran.com text_uthmani script in a single call, so the wording is
  // accurate and guaranteed to line up with the real Mushaf's line breaks.
  const { data: page, isLoading: pageLoading, isError: pageError } = useQuery({
    queryKey: ["mushaf-page", pageNumber],
    queryFn: () => fetchMushafPage(pageNumber),
    retry: 1,
  });

  // Surah names/bismillah flags rarely change - fetch once and reuse for
  // every page.
  const { data: surahs, isLoading: surahsLoading } = useQuery({
    queryKey: ["surahs"],
    queryFn: fetchSurahs,
    staleTime: Infinity,
  });

  const surahByNumber = useMemo(() => {
    const map = new Map<number, { nameArabic: string; bismillahPre: boolean }>();
    (surahs ?? []).forEach((s) => map.set(s.number, { nameArabic: s.nameArabic, bismillahPre: s.bismillahPre }));
    return map;
  }, [surahs]);

  const isLoading = pageLoading || surahsLoading;
  const pageAyahs = page?.ayahs ?? [];

  const [recitationState, setRecitationState] = useState<RecitationState>("idle");
  const [statuses, setStatuses] = useState<WordStatus[]>([]);
  const [cursorWordIndex, setCursorWordIndex] = useState(0);

  const recognitionRef = useRef<any>(null);
  const recitationStateRef = useRef<RecitationState>("idle");
  const finalTranscriptRef = useRef("");
  // Index of the last speech-recognition result we've already folded into
  // finalTranscriptRef. Some Android browsers don't honor event.resultIndex
  // reliably and resend already-finalized results on every event - without
  // this guard, that would get the same words appended again and again.
  const lastProcessedIndexRef = useRef(-1);
  const manualStopRef = useRef(false);

  // Flat word list for the whole page, each tagged with the index of the
  // ayah (within `pageAyahs`) it belongs to - this is what the alignment
  // algorithm walks through.
  const { pageWords, ayahRanges } = useMemo(() => {
    const words: string[] = [];
    const ranges: { start: number; end: number }[] = [];
    pageAyahs.forEach((ayah) => {
      const start = words.length;
      words.push(...ayah.words.map((w) => w.text));
      ranges.push({ start, end: words.length });
    });
    return { pageWords: words, ayahRanges: ranges };
  }, [pageAyahs]);

  // Group every word by the printed Mushaf line it falls on - text and
  // line numbers come from the same API response, so they always match.
  const lineGroups = useMemo(() => {
    type Token = { text: string; ayahIdx: number; isAyahEnd: boolean; line: number };
    const list: Token[] = [];

    pageAyahs.forEach((ayah, ayahIdx) => {
      ayah.words.forEach((word, wi) => {
        list.push({
          text: word.text,
          ayahIdx,
          isAyahEnd: wi === ayah.words.length - 1,
          line: word.line,
        });
      });
    });

    const groupsMap = new Map<number, Token[]>();
    list.forEach((t) => {
      if (!groupsMap.has(t.line)) groupsMap.set(t.line, []);
      groupsMap.get(t.line)!.push(t);
    });
    return Array.from(groupsMap.entries()).sort((a, b) => a[0] - b[0]);
  }, [pageAyahs]);

  const resetTracking = useCallback(() => {
    setStatuses(pageWords.map(() => "upcoming"));
    setCursorWordIndex(0);
    finalTranscriptRef.current = "";
    lastProcessedIndexRef.current = -1;
  }, [pageWords]);

  useEffect(() => {
    resetTracking();
    recitationStateRef.current = "idle";
    setRecitationState("idle");
  }, [pageNumber, resetTracking]);

  const initSpeechRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("متصفحك لا يدعم التعرف الصوتي. جرب Chrome على أندرويد.");
      return null;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    return recognition;
  }, []);

  const runAlignment = useCallback(
    (text: string) => {
      const recognizedWords = splitWords(text);
      const newStatuses = alignRecitation(pageWords, recognizedWords);
      setStatuses(newStatuses);
      const firstUpcoming = newStatuses.findIndex((s) => s === "upcoming");
      setCursorWordIndex(firstUpcoming === -1 ? pageWords.length : firstUpcoming);
    },
    [pageWords]
  );

  const startListening = useCallback(() => {
    const recognition = initSpeechRecognition();
    if (!recognition) return;

    recognitionRef.current = recognition;
    manualStopRef.current = false;
    resetTracking();
    setRecitationState("listening");
    recitationStateRef.current = "listening";

    recognition.onresult = (event: any) => {
      // If the results array shrank or restarted (some Android browsers
      // do this mid-session without firing onend), our progress marker
      // would be stale - treat it as a fresh sub-session.
      if (event.results.length <= lastProcessedIndexRef.current) {
        lastProcessedIndexRef.current = -1;
      }

      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          if (i > lastProcessedIndexRef.current) {
            finalTranscriptRef.current += text + " ";
            lastProcessedIndexRef.current = i;
          }
          // else: this final result was already folded in - skip it so
          // the same words don't get appended twice.
        } else if (i === event.results.length - 1) {
          interim = text;
        }
      }
      runAlignment(finalTranscriptRef.current + interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        alert("يرجى السماح بالوصول إلى الميكروفون.");
        manualStopRef.current = true;
        recitationStateRef.current = "idle";
        setRecitationState("idle");
      }
    };

    recognition.onend = () => {
      if (manualStopRef.current) {
        setRecitationState("completed");
        recitationStateRef.current = "completed";
        return;
      }
      if (recitationStateRef.current === "listening") {
        // Browser ended recognition on its own (brief silence) while the
        // user was still reading the page - restart silently.
        try {
          recognition.start();
        } catch {
          // already started
        }
      }
    };

    recognition.start();
  }, [initSpeechRecognition, resetTracking, runAlignment]);

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    } else {
      setRecitationState("completed");
      recitationStateRef.current = "completed";
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (recitationState === "listening") {
      stopListening();
    } else {
      startListening();
    }
  }, [recitationState, startListening, stopListening]);

  // Release the mic if the user navigates away mid-recitation.
  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);

  const goToPage = useCallback(
    (target: number) => {
      manualStopRef.current = true;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      const clamped = Math.min(Math.max(target, 1), TOTAL_MUSHAF_PAGES);
      navigate(`/page/${clamped}`);
    },
    [navigate]
  );

  function ayahStatus(rangeIdx: number): "upcoming" | "current" | "weak" | "good" {
    const range = ayahRanges[rangeIdx];
    if (!range) return "upcoming";
    if (cursorWordIndex < range.start) return "upcoming";
    if (cursorWordIndex < range.end) return "current";

    const slice = statuses.slice(range.start, range.end);
    const matchedCount = slice.filter((s) => s === "matched").length;
    const ratio = slice.length > 0 ? matchedCount / slice.length : 1;
    return ratio >= 0.6 ? "good" : "weak";
  }

  const statusClasses: Record<string, string> = {
    upcoming: "",
    current: "bg-emerald-200/70 dark:bg-emerald-800/50 rounded px-0.5",
    weak: "border-b-2 border-amber-500 dark:border-amber-400",
    good: "",
  };

  const pageBg = "bg-gradient-to-b from-[#f6ecd3] to-[#eddfb8] dark:from-[#1c1509] dark:to-[#120d05]";

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${pageBg}`}>
        <p className="text-amber-800 dark:text-amber-200">جارٍ تحميل الصفحة...</p>
      </div>
    );
  }

  if (pageError || pageAyahs.length === 0) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${pageBg}`}>
        <p className="text-red-600">لم يتم العثور على بيانات هذه الصفحة.</p>
      </div>
    );
  }

  const matchedTotal = statuses.filter((s) => s === "matched").length;
  const progressPercent = pageWords.length > 0 ? Math.round((matchedTotal / pageWords.length) * 100) : 0;

  return (
    <div className={`min-h-screen ${pageBg} pb-28`} dir="rtl">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-emerald-800 text-white px-4 py-3 flex items-center justify-between shadow border-b-2 border-amber-500/60">
        <Link to="/">
          <Button size="icon" variant="ghost" className="text-white hover:bg-emerald-700">
            <HomeIcon className="h-5 w-5" />
          </Button>
        </Link>
        <span className="font-semibold">صفحة {toArabicNumerals(pageNumber)} من المصحف</span>
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-emerald-700"
          onClick={resetTracking}
          title="إعادة الصفحة"
        >
          <RotateCcw className="h-5 w-5" />
        </Button>
      </div>

      {/* Mushaf page card */}
      <div className="px-3 sm:px-5 py-6 sm:py-10">
        <div className="max-w-2xl mx-auto">
          <div
            className="relative rounded-xl sm:rounded-2xl border-[5px] sm:border-[6px] border-double border-amber-700/70 dark:border-amber-500/50 bg-[#fbf3df] dark:bg-[#241c0d] shadow-lg px-4 sm:px-9 py-8 sm:py-10"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(120,53,15,0.08) 1px, transparent 0)",
              backgroundSize: "14px 14px",
            }}
          >
            <CornerOrnament className="absolute top-2 right-2" />
            <CornerOrnament className="absolute top-2 left-2 -scale-x-100" />
            <CornerOrnament className="absolute bottom-2 right-2 -scale-y-100" />
            <CornerOrnament className="absolute bottom-2 left-2 -scale-x-100 -scale-y-100" />

            {(() => {
              let lastSurahNumber: number | null = null;
              return pageAyahs.map((ayah, ayahIdx) => {
                const surahInfo = surahByNumber.get(ayah.surahNumber);
                const showSurahHeader = ayah.surahNumber !== lastSurahNumber;
                const showBismillah =
                  showSurahHeader && surahInfo?.bismillahPre && ayah.ayahNumber === 1;
                lastSurahNumber = ayah.surahNumber;

                return (
                  <div key={`${ayah.verseKey}-${ayahIdx}`}>
                    {showSurahHeader && (
                      <div className="text-center my-5 sm:my-6">
                        <div className="inline-block border-y-2 border-amber-700/70 dark:border-amber-500/60 px-8 py-2">
                          <span className="text-amber-900 dark:text-amber-200 font-bold text-lg font-arabic">
                            سورة {surahInfo?.nameArabic ?? ""}
                          </span>
                        </div>
                      </div>
                    )}
                    {showBismillah && (
                      <p className="text-center font-arabic text-2xl text-amber-900 dark:text-amber-200 mb-4">
                        {BISMILLAH}
                      </p>
                    )}
                  </div>
                );
              });
            })()}

            <div className="space-y-0.5">
              {lineGroups.map(([lineNum, lineTokens]) => (
                <div
                  key={lineNum}
                  dir="rtl"
                  className="font-arabic text-lg sm:text-xl md:text-2xl leading-[2.1] text-[#2c1d05] dark:text-[#f3e6c4]"
                  style={{
                    textAlign: "justify",
                    // Without this, a browser won't stretch a line that it
                    // thinks is the "last line" of its block - and since
                    // each line here is its own block, every single one
                    // would otherwise render unjustified instead of
                    // edge-to-edge like a real Mushaf line.
                    textAlignLast: "justify",
                    wordSpacing: "0.05em",
                  }}
                >
                  {lineTokens.map((t, i) => (
                    <span key={i} className={statusClasses[ayahStatus(t.ayahIdx)]}>
                      {t.text}
                      {t.isAyahEnd && (
                        <span className="text-emerald-700 dark:text-emerald-400 mx-1">
                          {" "}﴿{toArabicNumerals(pageAyahs[t.ayahIdx].ayahNumber)}﴾
                        </span>
                      )}
                      {!t.isAyahEnd && " "}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="fixed bottom-0 inset-x-0 bg-[#fbf3df] dark:bg-[#241c0d] border-t-2 border-amber-700/40 dark:border-amber-500/30 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goToPage(pageNumber + 1)}
            disabled={pageNumber >= TOTAL_MUSHAF_PAGES}
            title="الصفحة التالية"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          <Button
            className={
              recitationState === "listening"
                ? "flex-1 bg-red-600 hover:bg-red-700"
                : "flex-1 bg-emerald-700 hover:bg-emerald-800"
            }
            onClick={toggleListening}
          >
            {recitationState === "listening" ? (
              <>
                <MicOff className="h-5 w-5 ml-2" /> إيقاف الاستماع
              </>
            ) : (
              <>
                <Mic className="h-5 w-5 ml-2" /> ابدأ القراءة
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => goToPage(pageNumber - 1)}
            disabled={pageNumber <= 1}
            title="الصفحة السابقة"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {(recitationState === "listening" || recitationState === "completed") && (
          <div className="max-w-2xl mx-auto mt-2 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
            <span>تقدّمك في الصفحة: {progressPercent}%</span>
            <Badge variant="outline" className="border-amber-500 text-amber-800 dark:text-amber-300">
              تحت الخط الأصفر = راجع الآية
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
