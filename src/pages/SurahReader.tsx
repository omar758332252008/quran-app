import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSurahWithAyahs } from "@/lib/quran";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Mic,
  MicOff,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

// Word comparison result
type WordResult = {
  word: string;
  status: "correct" | "incorrect" | "pending";
};

type RecitationState = "idle" | "listening" | "processing" | "completed";

// Remove diacritics for comparison
function normalizeArabic(text: string): string {
  return text
    .replace(/[ًٌٍَُِّْٰ]/g, "") // Remove tashkeel
    .replace(/[إأآا]/g, "ا") // Normalize alef variants
    .replace(/ى/g, "ي") // Normalize alef maksura
    .replace(/ة/g, "ه") // Normalize ta marbuta
    .replace(/[\u0640]/g, "") // Remove tatweel
    .trim();
}

// Split Arabic text into words
function splitArabicWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

// Compare recognized words with original, word by word in the same
// position. Matching by position (instead of "does this word appear
// anywhere in what was said") is what makes the correction trustworthy:
// it flags a swapped, skipped, or wrong word exactly where it happened,
// rather than matching it against an unrelated word elsewhere in the verse.
function compareWords(original: string[], recognized: string[]): WordResult[] {
  const normalizedOriginal = original.map(normalizeArabic);
  const normalizedRecognized = recognized.map(normalizeArabic);

  return original.map((origWord, i) => {
    const origNorm = normalizedOriginal[i];
    const recNorm = normalizedRecognized[i];

    const isCorrect =
      recNorm !== undefined &&
      (recNorm === origNorm || recNorm.includes(origNorm) || origNorm.includes(recNorm));

    return {
      word: origWord,
      status: isCorrect ? "correct" : "incorrect",
    };
  });
}

export default function SurahReader() {
  const { surahNumber } = useParams<{ surahNumber: string }>();
  const num = parseInt(surahNumber || "1");
  
  const { data, isLoading } = useQuery({
    queryKey: ["surah", num],
    queryFn: () => fetchSurahWithAyahs(num),
  });
  
  const [currentAyahIndex, setCurrentAyahIndex] = useState(0);
  const [recitationState, setRecitationState] = useState<RecitationState>("idle");
  const [wordResults, setWordResults] = useState<WordResult[]>([]);
  const [transcript, setTranscript] = useState("");
  const [accuracy, setAccuracy] = useState(0);
  const [showComparison, setShowComparison] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mirrors recitationState so recognition.onend (defined once per
  // startListening call) always reads the *current* value instead of the
  // value that was captured when the closure was created.
  const recitationStateRef = useRef<RecitationState>("idle");
  // Mirrors the finalized transcript so stopListening can read it
  // synchronously without waiting on a React state update.
  const finalTranscriptRef = useRef("");
  // True once the user has asked to stop, so onend knows not to
  // auto-restart and that any pending final result has already arrived.
  const manualStopRef = useRef(false);
  
  const currentAyah = data?.ayahs[currentAyahIndex];
  const surah = data?.surah;

  const runComparison = useCallback(() => {
    if (currentAyah && finalTranscriptRef.current.trim()) {
      const originalWords = splitArabicWords(currentAyah.arabicText);
      const recognizedWords = splitArabicWords(finalTranscriptRef.current);
      const results = compareWords(originalWords, recognizedWords);
      
      setWordResults(results);
      setShowComparison(true);
      
      const correctCount = results.filter((r) => r.status === "correct").length;
      const totalCount = results.length;
      setAccuracy(totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0);
    }
    setRecitationState("completed");
    recitationStateRef.current = "completed";
  }, [currentAyah]);
  
  // Initialize speech recognition
  const initSpeechRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert("متصفحك لا يدعم التعرف الصوتي. جرب Chrome.");
      return null;
    }
    
    const recognition = new SpeechRecognition();
    recognition.lang = "ar-SA";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    
    return recognition;
  }, []);
  
  // Start listening
  const startListening = useCallback(() => {
    const recognition = initSpeechRecognition();
    if (!recognition) return;
    
    recognitionRef.current = recognition;
    manualStopRef.current = false;
    finalTranscriptRef.current = "";
    setRecitationState("listening");
    recitationStateRef.current = "listening";
    setTranscript("");
    setWordResults([]);
    setShowComparison(false);
    setAccuracy(0);
    
    recognition.onresult = (event: any) => {
      let interim = "";
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += text + " ";
        } else {
          interim += text;
        }
      }
      
      setTranscript(finalTranscriptRef.current + interim);
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
        // The user asked to stop. By the time `onend` fires, any final
        // result pending from `.stop()` has already reached onresult,
        // so it's now safe to score the attempt.
        runComparison();
        return;
      }
      if (recitationStateRef.current === "listening") {
        // The browser ended recognition on its own (e.g. a short silence
        // timeout) while the user was still reciting - restart silently
        // instead of leaving a dead mic with the "listening" UI still on.
        try {
          recognition.start();
        } catch {
          // Already started
        }
      }
    };
    
    recognition.start();
  }, [initSpeechRecognition, runComparison]);
  
  // Stop listening and compare
  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    setRecitationState("processing");
    recitationStateRef.current = "processing";
    
    if (recognitionRef.current) {
      // The actual comparison runs inside recognition.onend, once the
      // browser confirms it has stopped and flushed the last result.
      recognitionRef.current.stop();
    } else {
      runComparison();
    }
  }, [runComparison]);
  
  // Toggle listening
  const toggleListening = useCallback(() => {
    if (recitationState === "idle" || recitationState === "completed") {
      startListening();
    } else {
      stopListening();
    }
  }, [recitationState, startListening, stopListening]);
  
  // Reset current ayah
  const resetAyah = useCallback(() => {
    manualStopRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    recitationStateRef.current = "idle";
    setRecitationState("idle");
    setTranscript("");
    finalTranscriptRef.current = "";
    setWordResults([]);
    setShowComparison(false);
    setAccuracy(0);
  }, []);
  
  // Navigate to next ayah
  const nextAyah = useCallback(() => {
    resetAyah();
    if (data && currentAyahIndex < data.ayahs.length - 1) {
      setCurrentAyahIndex((prev) => prev + 1);
    }
  }, [data, currentAyahIndex, resetAyah]);
  
  // Navigate to prev ayah
  const prevAyah = useCallback(() => {
    resetAyah();
    if (currentAyahIndex > 0) {
      setCurrentAyahIndex((prev) => prev - 1);
    }
  }, [currentAyahIndex, resetAyah]);
  
  // Scroll to current ayah
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentAyahIndex]);

  // Release the microphone if the user navigates away while recognition
  // is still active, instead of leaving it running in the background.
  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, []);
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-slate-900 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-emerald-400/60">جاري تحميل السورة...</p>
        </div>
      </div>
    );
  }
  
  if (!data || !currentAyah) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-slate-900 flex items-center justify-center" dir="rtl">
        <p className="text-emerald-400/60">لم يتم العثور على السورة</p>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-slate-900 text-white" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-emerald-950/90 backdrop-blur-md border-b border-emerald-800/50">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/">
              <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-200 hover:bg-emerald-800/40">
                <ArrowRight className="w-4 h-4 ml-1" />
                السور
              </Button>
            </Link>
            <div className="text-center">
              <h1 className="font-bold text-emerald-100 text-sm">
                سورة {surah?.nameArabic}
              </h1>
              <p className="text-[10px] text-emerald-400/50">
                آية {currentAyahIndex + 1} من {data.ayahs.length}
              </p>
            </div>
            <div className="w-20" />
          </div>
        </div>
      </header>
      
      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Surah Info */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-emerald-100 mb-1">
            {surah?.nameArabic}
          </h2>
          <p className="text-sm text-emerald-400/60">
            {surah?.nameEnglish} - {surah?.versesCount} آية - {surah?.revelationPlace === "makkah" ? "مكية" : "مدنية"}
          </p>
        </div>
        
        {/* Progress bar */}
        <div className="mb-6 px-4">
          <div className="flex items-center justify-between text-xs text-emerald-400/50 mb-2">
            <span>آية {currentAyahIndex + 1}</span>
            <span>من {data.ayahs.length}</span>
          </div>
          <div className="h-1.5 bg-emerald-900/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${((currentAyahIndex + 1) / data.ayahs.length) * 100}%` }}
            />
          </div>
        </div>
        
        {/* Ayah Display */}
        <Card className="bg-emerald-900/20 border-emerald-800/40 mb-6">
          <CardContent className="p-6 md:p-8">
            <div ref={scrollRef} className="text-center">
              {/* Ayah number badge */}
              <div className="flex justify-center mb-4">
                <Badge variant="outline" className="border-emerald-700/50 text-emerald-400/70 bg-emerald-900/30 px-3 py-1">
                  آية {currentAyah.ayahNumber}
                </Badge>
              </div>
              
              {/* Arabic text with word coloring */}
              <div className="leading-loose text-2xl md:text-3xl font-quran text-emerald-50" style={{ fontFamily: "'Amiri', 'Scheherazade New', 'Traditional Arabic', serif" }}>
                {showComparison && wordResults.length > 0 ? (
                  wordResults.map((result, idx) => (
                    <span
                      key={idx}
                      className={`inline-block mx-1 px-1.5 py-0.5 rounded-md transition-all duration-300 ${
                        result.status === "correct"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : result.status === "incorrect"
                          ? "bg-red-500/30 text-red-300 line-through decoration-red-500"
                          : "text-emerald-50"
                      }`}
                    >
                      {result.word}
                    </span>
                  ))
                ) : (
                  <span>{currentAyah.arabicText}</span>
                )}
              </div>
              
              {/* Transliteration */}
              {currentAyah.transliteration && (
                <p className="text-emerald-400/40 text-sm mt-4 italic">
                  {currentAyah.transliteration}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Accuracy Score */}
        {showComparison && (
          <Card className="bg-emerald-900/20 border-emerald-800/40 mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {accuracy >= 80 ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-amber-400" />
                  )}
                  <span className="text-sm text-emerald-200">نسبة الدقة</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-bold" style={{ color: accuracy >= 80 ? "#34d399" : accuracy >= 50 ? "#fbbf24" : "#f87171" }}>
                    {accuracy}%
                  </div>
                  <div className="text-xs text-emerald-400/50">
                    {wordResults.filter((w) => w.status === "correct").length} / {wordResults.length} كلمات صحيحة
                  </div>
                </div>
              </div>
              
              {/* Word breakdown */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {wordResults.map((result, idx) => (
                  <span
                    key={idx}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      result.status === "correct"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {normalizeArabic(result.word)}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Transcript Display */}
        {transcript && (
          <Card className="bg-emerald-900/10 border-emerald-800/30 mb-6">
            <CardContent className="p-4">
              <p className="text-xs text-emerald-400/50 mb-1">ما سمعه التطبيق:</p>
              <p className="text-emerald-200/80 text-sm" style={{ direction: "rtl" }}>
                {transcript}
              </p>
            </CardContent>
          </Card>
        )}
        
        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <Button
            variant="outline"
            size="icon"
            onClick={prevAyah}
            disabled={currentAyahIndex === 0}
            className="border-emerald-700/50 text-emerald-400 hover:bg-emerald-800/40 disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
          
          {/* Main mic button */}
          <Button
            onClick={toggleListening}
            className={`w-16 h-16 rounded-full transition-all duration-300 ${
              recitationState === "listening"
                ? "bg-red-500 hover:bg-red-600 animate-pulse"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {recitationState === "listening" ? (
              <MicOff className="w-6 h-6" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </Button>
          
          <Button
            variant="outline"
            size="icon"
            onClick={nextAyah}
            disabled={currentAyahIndex >= data.ayahs.length - 1}
            className="border-emerald-700/50 text-emerald-400 hover:bg-emerald-800/40 disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </div>
        
        {/* Status text */}
        <div className="text-center mb-4">
          {recitationState === "idle" && (
            <p className="text-sm text-emerald-400/60">اضغط على الميكروفون واقرأ الآية</p>
          )}
          {recitationState === "listening" && (
            <p className="text-sm text-red-400 animate-pulse">يسمع... اضغط مرة أخرى للتوقف</p>
          )}
          {recitationState === "processing" && (
            <p className="text-sm text-emerald-400/60">جاري التحليل...</p>
          )}
          {recitationState === "completed" && (
            <p className="text-sm text-emerald-400/60">تم! اضغط السهم للانتقال للآية التالية</p>
          )}
        </div>
        
        {/* Reset button */}
        {(recitationState === "completed" || recitationState === "listening") && (
          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetAyah}
              className="text-emerald-400/60 hover:text-emerald-300"
            >
              <RotateCcw className="w-3 h-3 ml-1" />
              إعادة المحاولة
            </Button>
          </div>
        )}
        
        {/* Ayah list */}
        <Separator className="my-8 bg-emerald-800/30" />
        
        <div>
          <h3 className="text-sm font-bold text-emerald-300/70 mb-4">آيات السورة</h3>
          <ScrollArea className="h-64 rounded-lg border border-emerald-800/30 bg-emerald-900/10">
            <div className="p-3 space-y-2">
              {data.ayahs.map((ayah, idx) => (
                <button
                  key={ayah.id}
                  onClick={() => {
                    resetAyah();
                    setCurrentAyahIndex(idx);
                  }}
                  className={`w-full text-right p-2.5 rounded-lg transition-all text-sm ${
                    idx === currentAyahIndex
                      ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-100"
                      : "text-emerald-400/60 hover:bg-emerald-800/30"
                  }`}
                  style={{ direction: "rtl" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-500/50 font-mono w-8 text-center">
                      {ayah.ayahNumber}
                    </span>
                    <span className="truncate flex-1" style={{ fontFamily: "'Amiri', 'Scheherazade New', serif" }}>
                      {ayah.arabicText}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      </main>
    </div>
  );
}
