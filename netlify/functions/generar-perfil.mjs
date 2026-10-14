// Genera el perfil de creador y las 5 sugerencias usando Google Gemini (plan gratuito).
import { createClient } from '@supabase/supabase-js';
import { PREGUNTAS } from '../../public/js/preguntas.js';

const MAX_INTENTOS = 3; // protege tu cuota gratuita; el admin puede reiniciar

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const INSTRUCCIONES = `Eres la estratega de marca personal de "Michi Cifuentes", una consultora que ayuda a personas a convertirse en creadoras de contenido.
Analiza las respuestas de un cuestionario de 15 preguntas y construye un perfil honesto, cálido y muy concreto.
Reglas:
- Escribe en español neutro, tuteando, con frases cortas y claras.
- Basa todo en lo que la persona respondió. Cita o retoma sus propias palabras cuando ayude. No inventes datos sobre su vida.
- Respeta sus límites (lo que no quiere mostrar) y su tiempo disponible: las sugerencias deben poder cumplirse con sus horas y su equipo.
- Usa lenguaje inclusivo neutro (evita marcar género si no lo sabes).
- Las 5 sugerencias deben ser distintas entre sí en formato o ángulo, y cada una con un ejemplo de publicación listo para grabar o escribir.
Responde SOLO con un objeto JSON válido, sin texto adicional ni bloques de código, con esta estructura exacta:
{
  "arquetipo": "nombre corto y memorable del tipo de creador (2 a 4 palabras)",
  "resumen": "párrafo de 3 a 4 frases que describe a la persona como creadora",
  "nicho": "nicho recomendado en una frase",
  "propuesta_valor": "una frase: ayudo a [quién] a [qué] a través de [cómo]",
  "audiencia": "descripción breve de su audiencia ideal",
  "tono": "tono de comunicación recomendado en una frase",
  "formatos": ["2 a 3 formatos ideales"],
  "plataformas": [{"nombre": "plataforma", "por_que": "una frase"}],
  "fortalezas": ["3 a 4 fortalezas concretas"],
  "oportunidades": ["3 a 4 áreas de desarrollo, en positivo y accionables"],
  "sugerencias": [
    {"titulo": "nombre de la serie o idea", "formato": "reel, carrusel, video largo, etc.", "plataforma": "dónde publicarlo",
     "descripcion": "de qué se trata y por qué encaja con esta persona", "ejemplo": "una publicación concreta: gancho inicial y desarrollo",
     "frecuencia": "frecuencia sugerida"}
  ],
  "primeros_pasos": ["3 acciones para los próximos 7 días"]
}
"sugerencias" debe tener exactamente 5 elementos y "plataformas" de 1 a 3.`;

function extraerJSON(texto) {
  const limpio = texto.replace(/```json|```/g, '').trim();
  const ini = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  return JSON.parse(limpio.slice(ini, fin + 1));
}

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

  // Modelo por defecto. Si Google retira este modelo, crea en Netlify la variable GEMINI_MODEL con el nombre nuevo.
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

  // Menos "razonamiento" = respuesta más rápida, para no pasar el tiempo límite de Netlify (~10 s).
  const pensamiento = /gemini-2\.5/.test(modelo)
    ? { thinkingBudget: 0 }
    : /gemini-3/.test(modelo) ? { thinkingLevel: 'low' } : null;

  const llamarIA = (conPensamiento) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
      contents: [{ role: 'user', parts: [{ text: `Nombre: ${perfil.nombre}\n\n${textoRespuestas}` }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
        ...(conPensamiento && pensamiento ? { thinkingConfig: pensamiento } : {}),
      },
    }),
  });

  let resultado;
  try {
    let resp = await llamarIA(true);
    // Si el modelo no acepta el ajuste de razonamiento, se reintenta sin él.
    if (resp.status === 400 && pensamiento) resp = await llamarIA(false);
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || resp.statusText;
      if (resp.status === 429) return json(429, { error: 'La IA alcanzó su límite gratuito por ahora. Intenta de nuevo en unos minutos.' });
      return json(502, { error: 'La IA no respondió correctamente: ' + msg });
    }
    const texto = (data.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || '').join('');
    resultado = extraerJSON(texto);
    if (!Array.isArray(resultado.sugerencias) || resultado.sugerencias.length === 0) throw new Error('sin sugerencias');
  } catch (e) {
    return json(502, { error: 'No se pudo generar el perfil. Intenta de nuevo en un momento.' });
  }

  const { error: errGuardar } = await sb.from('resultados').upsert({
    user_id: uid, resultado, intentos: intentos + 1, generado_en: new Date().toISOString(),
  });
  if (errGuardar) return json(500, { error: 'El perfil se generó pero no se pudo guardar. Intenta de nuevo.' });

  return json(200, { resultado });
};
