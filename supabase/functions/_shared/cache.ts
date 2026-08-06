// Cache-lag oven på Postgres. Tabellerne har RLS slået til uden policies, så
// de er utilgængelige for anon/authenticated — kun service-nøglen (som går
// uden om RLS) kan læse og skrive dem. Cachen eksponeres derfor aldrig
// direkte mod browseren, kun gennem funktionerne her.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Supabase injicerer selv nøglerne. Navnet på hemmeligheden har ændret sig
// over tid, så vi accepterer begge frem for at knække ved en platformopdatering.
const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

export async function readCache<T>(
  table: string,
  keyColumn: string,
  key: string,
  valueColumn: string,
  maxAgeMs: number
): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select(`${valueColumn}, fetched_at`)
    .eq(keyColumn, key)
    .maybeSingle();

  if (error || !data) return null;

  const age = Date.now() - new Date((data as Record<string, string>).fetched_at).getTime();
  if (age > maxAgeMs) return null;

  return (data as Record<string, unknown>)[valueColumn] as T;
}

export async function writeCache(table: string, row: Record<string, unknown>): Promise<void> {
  // Cache-skrivning må aldrig vælte selve svaret til brugeren — en fejlet
  // upsert betyder bare at næste kald går til kilden igen.
  const { error } = await supabase
    .from(table)
    .upsert({ ...row, fetched_at: new Date().toISOString() });

  if (error) console.error(`cache-skrivning fejlede for ${table}:`, error.message);
}
