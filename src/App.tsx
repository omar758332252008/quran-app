import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import MushafPage from "./pages/MushafPage";
import SurahRedirect from "./pages/SurahRedirect";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/page/:pageNumber" element={<MushafPage />} />
      <Route path="/surah/:surahNumber" element={<SurahRedirect />} />
    </Routes>
  );
}
