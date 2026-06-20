import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchPageAyahs, TOTAL_MUSHAF_PAGES, type PageAyah } from "@/lib/quran";
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

export default function MushafPage() {
  const { pageNumber: pageParam } = useParams<{ pageNumber: string }>();
  const navigate = useNavigate();
  const pageNumber = Math.min(Math.max(parseInt(pageParam || "1"), 1), TOTAL_MUSHAF_PAGES);

  const { data: ayahs, isLoading } = useQuery({
    queryKey: ["page", pageNumber],
    queryFn: () => fetchPageAyahs(pageNumber),
  });

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
  // ayah (within `ayahs`) it belongs to - this is what the alignment
  // algorithm walks through.
  const { pageWords, ayahRanges } = useMemo(() => {
    const words: string[] = [];
    const ranges: { start: number; end: number }[] = [];
    (ayahs ?? []).forEach((ayah) => {
      const start = words.length;
      words.push(...splitWords(ayah.arabicText));
      ranges.push({ start, end: words.length });
    });
    return { pageWords: words, ayahRanges: ranges };
  }, [ayahs]);

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
    weak: "border-b-2 border-amber-400 dark:border-amber-500",
    good: "",
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 dark:bg-emerald-950">
        <p className="text-emerald-700 dark:text-emerald-300">جارٍ تحميل الصفحة...</p>
      </div>
    );
  }

  if (!ayahs || ayahs.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 dark:bg-emerald-950">
        <p className="text-red-600">لم يتم العثور على بيانات هذه الصفحة.</p>
      </div>
    );
  }

  const matchedTotal = statuses.filter((s) => s === "matched").length;
  const progressPercent = pageWords.length > 0 ? Math.round((matchedTotal / pageWords.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-emerald-50 dark:bg-emerald-950 pb-28" dir="rtl">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-emerald-700 text-white px-4 py-3 flex items-center justify-between shadow">
        <Link to="/">
          <Button size="icon" variant="ghost" className="text-white hover:bg-emerald-600">
            <HomeIcon className="h-5 w-5" />
          </Button>
        </Link>
        <span className="font-semibold">صفحة {toArabicNumerals(pageNumber)} من المصحف</span>
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-emerald-600"
          onClick={resetTracking}
          title="إعادة الصفحة"
        >
          <RotateCcw className="h-5 w-5" />
        </Button>
      </div>

      {/* Mushaf text */}
      <div className="max-w-2xl mx-auto px-5 py-8">
        {(() => {
          let lastSurahNumber: number | null = null;
          return ayahs.map((ayah: PageAyah) => {
            const showSurahHeader = ayah.surahNumber !== lastSurahNumber;
            const showBismillah =
              showSurahHeader && ayah.surahBismillahPre && ayah.ayahNumber === 1;
            lastSurahNumber = ayah.surahNumber;

            return (
              <div key={ayah.id}>
                {showSurahHeader && (
                  <div className="text-center my-6">
                    <div className="inline-block border-2 border-emerald-600 rounded-lg px-6 py-2 bg-emerald-100 dark:bg-emerald-900">
                      <span className="text-emerald-800 dark:text-emerald-200 font-bold text-lg">
                        سورة {ayah.surahNameArabic}
                      </span>
                    </div>
                  </div>
                )}
                {showBismillah && (
                  <p className="text-center font-arabic text-2xl text-emerald-800 dark:text-emerald-200 mb-4">
                    {BISMILLAH}
                  </p>
                )}
              </div>
            );
          });
        })()}

        <p
          className="text-justify leading-loose text-2xl font-arabic text-emerald-950 dark:text-emerald-50"
          style={{ wordSpacing: "0.15em" }}
        >
          {ayahs.map((ayah: PageAyah, idx: number) => (
            <span key={ayah.id} className={statusClasses[ayahStatus(idx)]}>
              {ayah.arabicText}
              <span className="text-emerald-600 dark:text-emerald-400 mx-1">
                ﴿{toArabicNumerals(ayah.ayahNumber)}﴾
              </span>{" "}
            </span>
          ))}
        </p>
      </div>

      {/* Bottom controls */}
      <div className="fixed bottom-0 inset-x-0 bg-white dark:bg-emerald-900 border-t border-emerald-200 dark:border-emerald-800 px-4 py-3">
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
                : "flex-1 bg-emerald-600 hover:bg-emerald-700"
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
          <div className="max-w-2xl mx-auto mt-2 flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300">
            <span>تقدّمك في الصفحة: {progressPercent}%</span>
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
              تحت الخط الأصفر = راجع الآية
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
