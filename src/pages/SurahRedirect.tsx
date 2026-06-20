import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router";
import { supabase } from "@/lib/supabase";

// Lets old links like /surah/2 keep working by resolving the surah number
// to the Mushaf page it starts on, then redirecting there.
export default function SurahRedirect() {
  const { surahNumber } = useParams<{ surahNumber: string }>();
  const [startPage, setStartPage] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("surahs")
      .select("start_page")
      .eq("number", parseInt(surahNumber || "1"))
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.start_page) {
          setNotFound(true);
        } else {
          setStartPage(data.start_page);
        }
      });
    return () => {
      active = false;
    };
  }, [surahNumber]);

  if (notFound) return <Navigate to="/" replace />;
  if (!startPage) return null;
  return <Navigate to={`/page/${startPage}`} replace />;
}
