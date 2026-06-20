import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import SurahReader from "./pages/SurahReader";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/surah/:surahNumber" element={<SurahReader />} />
    </Routes>
  );
}
