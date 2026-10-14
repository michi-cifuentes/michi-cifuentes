// Genera la guía de producción paso a paso de UNA idea de contenido (guion visual, pasos, texto, etc.).
// Se llama una vez por idea para no pasar el tiempo límite de Netlify. La guía queda guardada.
import { createClient } from '@supabase/supabase-js';
import { pedirJSON, mensajeError } from '../lib/gemini.mjs';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const INSTRUCCIONES = `Eres productora de contenido senior en "Michi Cifuentes", consultora de marca personal.
Tu tarea: convertir UNA idea de contenido en una guía de producción profesional, tan concreta que una persona sin experiencia pueda grabarla y publicarla hoy mismo.

Reglas de calidad (obligatorias):
- Español neutro, tuteando, instrucciones en imperativo ("Graba...", "Escribe...", "Coloca...").
- Escribe el contenido REAL: textos exactos, frases exactas que se dicen, qué se ve en cada toma. Prohibido escribir "explica por qué", "habla de", "menciona algo": escribe lo que se dice.
- Adapta todo al nicho, tono, audiencia, equipo y límites de la persona.
- Si el formato es video (Reel, TikTok, Short, Historia, video), el guion son escenas con tiempos ("0–3 s") y tipo de plano (primer plano a cámara, plano detalle de manos, pantalla grabada, plano general...).
- Si es carrusel o post, el guion son diapositivas ("Diapositiva 1"...), "plano" describe el diseño (fondo, foto, tipografía) y "dices" es el texto de apoyo de esa diapositiva.
- "texto_pantalla" es el texto grande que aparece sobre la imagen: máximo 10 palabras.
- Herramientas: solo gratuitas o que ya tiene.

Responde SOLO con un objeto JSON válido, sin texto adicional, con esta estructura exacta:
{
  "objetivo": "qué logra esta publicación y para quién, en una frase",
  "duracion": "duración o cantidad de diapositivas recomendada",
  "guion": [
    {"momento": "0–3 s · Gancho" o "Diapositiva 1 · Portada", "plano": "tipo de toma o diseño", "se_ve": "qué se ve, concreto", "texto_pantalla": "texto exacto en pantalla", "dices": "lo que dices palabra por palabra (o texto de apoyo)"}
  ],
  "pasos": [
    {"fase": "Preparación" | "Grabación" | "Diseño" | "Edición" | "Publicación", "accion": "instrucción concreta y verificable"}
  ],
  "copy": "texto completo de la publicación listo para copiar y pegar, con saltos de línea",
  "hashtags": ["#hashtag"],
  "llamado_accion": "frase exacta de cierre que invita a actuar",
  "cuando_publicar": "día y franja horaria sugerida, con el motivo en pocas palabras",
  "herramientas": ["herramienta y para qué"],
  "como_medir": "qué métrica revisar a las 48 horas y qué resultado indica que funcionó",
  "errores_a_evitar": ["error común y cómo evitarlo"]
}
"guion" debe tener de 4 a 7 elementos, "pasos" de 6 a 9, "hashtags" de 5 a 8, "errores_a_evitar" 2 o 3.`;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: quien, error: errQuien } = await sb.auth.getUser(token);
  if (errQuien || !quien?.user) return json(401, { error: 'Sesión no válida. Vuelve a iniciar sesión.' });

  let body = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const indice = Number(body.indice);

  // El admin puede completar las guías de un cliente; un cliente solo las suyas.
  const { data: quienPerfil } = await sb.from('perfiles').select('rol, activo').eq('id', quien.user.id).single();
  const esAdmin = quienPerfil?.rol === 'admin';
  if (!esAdmin && !quienPerfil?.activo) return json(403, { error: 'Tu acceso está desactivado.' });
  const uid = esAdmin && body.user_id ? body.user_id : quien.user.id;

  const { data: fila } = await sb.from('resultados').select('resultado').eq('user_id', uid).maybeSingle();
  const res = fila?.resultado;
  if (!res?.sugerencias?.[indice]) return json(404, { error: 'No se encontró esa idea de contenido.' });

  const idea = res.sugerencias[indice];
  if (idea.guia) return json(200, { guia: idea.guia }); // ya existe: no se gasta cuota

  const { data: resp } = await sb.from('respuestas').select('respuestas').eq('user_id', uid).maybeSingle();
  const r = resp?.respuestas || {};

  const contexto = `PERFIL DE LA PERSONA
Arquetipo: ${res.arquetipo || ''}
Nicho: ${res.nicho || ''}
Propuesta de valor: ${res.propuesta_valor || ''}
Audiencia: ${res.audiencia || ''}
Tono: ${res.tono || ''}
Cómo se expresa mejor: ${String(r.p5 || '').slice(0, 400)}
Habilidades técnicas: ${String(r.p6 || '').slice(0, 300)}
Horas por semana: ${String(r.p12 || '').slice(0, 200)}
Equipo disponible: ${String(r.p13 || '').slice(0, 300)}
Lo que NO quiere mostrar: ${String(r.p14 || '').slice(0, 300)}

IDEA A DESARROLLAR
Nombre: ${idea.titulo || ''}
Formato: ${idea.formato || ''}
Plataforma: ${idea.plataforma || ''}
Objetivo: ${idea.objetivo || ''}
Descripción: ${idea.descripcion || ''}
Primer episodio sugerido: ${idea.ejemplo || ''}
Frecuencia: ${idea.frecuencia || ''}`;

  const out = await pedirJSON({
    instrucciones: INSTRUCCIONES,
    mensaje: contexto,
    // Primero modelos rápidos: la guía es larga y debe caber en el tiempo límite de Netlify.
    modelos: [process.env.GEMINI_MODEL_GUIA, 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'],
    maxTokens: 3000,
    validar: (o) => Array.isArray(o.guion) && o.guion.length >= 3 && Array.isArray(o.pasos) && o.pasos.length >= 3,
  });
  if (!out.ok) return json(out.status === 429 ? 429 : 502, { error: mensajeError(out.status) });

  // Guardar sobre la versión más reciente del resultado
  const { data: actual } = await sb.from('resultados').select('resultado').eq('user_id', uid).maybeSingle();
  const resultado = actual?.resultado || res;
  if (resultado.sugerencias?.[indice]) resultado.sugerencias[indice].guia = out.data;
  const { error } = await sb.from('resultados').update({ resultado }).eq('user_id', uid);
  if (error) return json(500, { error: 'La guía se generó pero no se pudo guardar. Intenta de nuevo.' });

  return json(200, { guia: out.data });
};
