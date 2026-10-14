// Genera el perfil de creador y las 5 ideas de contenido usando Google Gemini (plan gratuito).
// La guía paso a paso de cada idea se genera aparte, en detallar-idea.mjs.
import { createClient } from '@supabase/supabase-js';
import { PREGUNTAS } from '../../public/js/preguntas.js';
import { pedirJSON, mensajeError } from '../lib/gemini.mjs';

const MAX_INTENTOS = 3; // protege tu cuota gratuita; el admin puede reiniciar

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const INSTRUCCIONES = `Eres la estratega senior de marca personal de "Michi Cifuentes", una consultora que acompaña a personas a convertirse en creadoras de contenido profesionales.
Analiza las respuestas de un cuestionario de 15 preguntas y entrega un diagnóstico de nivel consultoría: honesto, cálido, específico y accionable.

Reglas de calidad (obligatorias):
- Español neutro, tuteando, frases claras. Nada de relleno ni frases genéricas que servirían para cualquier persona.
- Todo debe basarse en lo que la persona respondió: retoma sus temas, su experiencia, sus palabras. No inventes datos de su vida.
- Respeta sus límites (lo que no quiere mostrar), su tiempo disponible y su equipo: cada idea debe poder producirse con lo que tiene.
- Lenguaje inclusivo neutro (no marques género si no lo sabes).
- Las 5 ideas deben ser distintas entre sí en formato y objetivo (por ejemplo: una de alcance, una de autoridad, una de conexión personal, una de comunidad, una de conversión).
- Cada idea es una SERIE o FORMATO RECURRENTE con nombre propio y atractivo, no un tema suelto.
- La "descripcion" explica en 2 frases qué es la serie y por qué encaja con ESTA persona (menciona algo concreto de sus respuestas).
- El "ejemplo" es el primer episodio real: escribe el gancho exacto entre comillas (lo que se dice o se lee en los primeros 3 segundos) y resume en una frase los 3 puntos que desarrolla. Prohibido escribir instrucciones vagas como "explica por qué" o "habla de": escribe el contenido mismo.

Responde SOLO con un objeto JSON válido, sin texto adicional ni bloques de código, con esta estructura exacta:
{
  "arquetipo": "nombre corto y memorable del tipo de creador (2 a 4 palabras)",
  "resumen": "párrafo de 3 a 4 frases que describe a la persona como creadora",
  "nicho": "nicho recomendado en una frase",
  "propuesta_valor": "una frase: ayudo a [quién] a [qué] a través de [cómo]",
  "audiencia": "descripción breve y concreta de su audiencia ideal",
  "tono": "tono de comunicación recomendado en una frase",
  "formatos": ["2 a 3 formatos ideales"],
  "plataformas": [{"nombre": "plataforma", "por_que": "una frase"}],
  "fortalezas": ["3 a 4 fortalezas concretas"],
  "oportunidades": ["3 a 4 áreas de desarrollo, en positivo y accionables"],
  "sugerencias": [
    {"titulo": "nombre de la serie", "formato": "Reel, Carrusel, Video largo, Historia, Post, etc.", "plataforma": "dónde publicarlo",
     "objetivo": "alcance, autoridad, conexión, comunidad o conversión",
     "descripcion": "2 frases: qué es y por qué encaja con esta persona",
     "ejemplo": "Gancho: \\"...\\" + resumen del desarrollo en una frase",
     "frecuencia": "frecuencia sugerida"}
  ],
  "primeros_pasos": ["3 acciones concretas para los próximos 7 días"]
}
"sugerencias" debe tener exactamente 5 elementos y "plataformas" de 1 a 3.`;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: quien, error: errQuien } = await sb.auth.getUser(token);
  if (errQuien || !quien?.user) return json(401, { error: 'Sesión no válida. Vuelve a iniciar sesión.' });
  const uid = quien.user.id;

  const { data: perfil } = await sb.from('perfiles').select('nombre, activo').eq('id', uid).single();
  if (!perfil?.activo) return json(403, { error: 'Tu acceso está desactivado.' });

  const { data: previo } = await sb.from('resultados').select('intentos').eq('user_id', uid).maybeSingle();
  const intentos = previo?.intentos || 0;
  if (intentos >= MAX_INTENTOS)
    return json(429, { error: 'Ya generaste tu perfil el máximo de veces permitido. Escribe a Michi Cifuentes si necesitas otro.' });

  const { data: fila } = await sb.from('respuestas').select('respuestas, acepto_privacidad').eq('user_id', uid).maybeSingle();
  if (!fila?.acepto_privacidad) return json(400, { error: 'Debes aceptar el aviso de privacidad antes de continuar.' });
  const r = fila.respuestas || {};
  const faltan = PREGUNTAS.filter((p) => !String(r[p.id] || '').trim());
  if (faltan.length) return json(400, { error: `Faltan ${faltan.length} respuestas por completar.` });

  const textoRespuestas = PREGUNTAS.map(
    (p, i) => `${i + 1}. ${p.texto}\nRespuesta: ${String(r[p.id]).slice(0, 1500)}`
  ).join('\n\n');

  // Modelos en orden de preferencia; si uno está saturado o no existe, se prueba el siguiente.
  const res = await pedirJSON({
    instrucciones: INSTRUCCIONES,
    mensaje: `Nombre: ${perfil.nombre}\n\n${textoRespuestas}`,
    modelos: [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'],
    maxTokens: 4000,
    validar: (o) => Array.isArray(o.sugerencias) && o.sugerencias.length > 0,
  });
  if (!res.ok) return json(res.status === 429 ? 429 : 502, { error: mensajeError(res.status) });

  const { error: errGuardar } = await sb.from('resultados').upsert({
    user_id: uid, resultado: res.data, intentos: intentos + 1, generado_en: new Date().toISOString(),
  });
  if (errGuardar) return json(500, { error: 'El perfil se generó pero no se pudo guardar. Intenta de nuevo.' });

  return json(200, { resultado: res.data });
};
