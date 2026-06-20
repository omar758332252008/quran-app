import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "متغيرات البيئة VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY غير موجودة. تأكد من ملف .env"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
