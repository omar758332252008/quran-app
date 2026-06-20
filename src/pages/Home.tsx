import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSurahs } from "@/lib/quran";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Mic } from "lucide-react";

export default function Home() {
  const [search, setSearch] = useState("");
  const { data: surahs, isLoading } = useQuery({
    queryKey: ["surahs"],
    queryFn: fetchSurahs,
  });

  const filteredSurahs = surahs?.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.nameArabic.includes(q) ||
      s.nameEnglish.toLowerCase().includes(q) ||
      s.number.toString().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-slate-900 text-white" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-emerald-950/90 backdrop-blur-md border-b border-emerald-800/50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-emerald-100">مصحف التلاوة الذكي</h1>
                <p className="text-xs text-emerald-400/70">تلاوة، تصحيح، وتعلم</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-emerald-400/70">التعرف الصوتي</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Hero */}
        <div className="text-center mb-8 py-8">
          <h2 className="text-4xl font-bold text-emerald-100 mb-3 leading-tight">
            اقرأ القرآن
          </h2>
          <p className="text-emerald-400/70 text-lg mb-2">
            وطبق يصحح لك كلمة كلمة
          </p>
          <p className="text-emerald-500/50 text-sm">
            اختر سورة، اقرأ بصوتك، ولاحظ الأخطاء باللون الأحمر
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6 max-w-md mx-auto">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن سورة..."
            className="pr-10 bg-emerald-900/40 border-emerald-700/50 text-white placeholder:text-emerald-500/40 focus-visible:ring-emerald-500/30"
            dir="rtl"
          />
        </div>

        {/* Surah List */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-emerald-400/60">جاري تحميل السور...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSurahs?.map((surah) => (
              <Link key={surah.id} to={`/surah/${surah.number}`}>
                <Card className="bg-emerald-900/30 border-emerald-800/40 hover:bg-emerald-800/40 hover:border-emerald-700/50 transition-all duration-300 cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 font-bold text-sm group-hover:bg-emerald-500/25 transition-colors">
                          {surah.number}
                        </div>
                        <div>
                          <h3 className="font-bold text-emerald-100 text-sm group-hover:text-emerald-50 transition-colors">
                            {surah.nameArabic}
                          </h3>
                          <p className="text-xs text-emerald-400/50">{surah.nameEnglish}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className="text-[10px] border-emerald-700/50 text-emerald-400/70 bg-emerald-900/30">
                          {surah.versesCount} آية
                        </Badge>
                        <span className="text-[10px] text-emerald-500/40">
                          {surah.revelationPlace === "makkah" ? "مكية" : "مدنية"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {filteredSurahs?.length === 0 && (
          <div className="text-center py-12 text-emerald-400/50">
            <p>لا توجد نتائج مطابقة</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-emerald-800/30 mt-12 py-6">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-emerald-500/40 text-sm">
            مصحف التلاوة الذكي - تعلم القرآن بطريقة تفاعلية
          </p>
        </div>
      </footer>
    </div>
  );
}
