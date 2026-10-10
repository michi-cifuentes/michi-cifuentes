// Entrega al navegador solo los datos públicos de Supabase (nunca la clave de servicio).
export default async () =>
  new Response(
    JSON.stringify({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
