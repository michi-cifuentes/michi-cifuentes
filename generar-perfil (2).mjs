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

  // Modelos en orden de preferencia. Si uno está saturado o no existe, se prueba el siguiente.
  // Para forzar otro modelo primero, crea en Netlify la variable GEMINI_MODEL.
  const modelos = [...new Set([
    process.env.GEMINI_MODEL,
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
  ].filter(Boolean))];

  const inicio = Date.now();
  const LIMITE_MS = 9500; // Netlify corta las funciones gratuitas cerca de los 10 s

  const cuerpo = (modelo, conPensamiento) => {
    const pensamiento = /gemini-2\.5/.test(modelo)
      ? { thinkingBudget: 0 }
      : /gemini-3/.test(modelo) ? { thinkingLevel: 'low' } : null;
    return JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
      contents: [{ role: 'user', parts: [{ text: `Nombre: ${perfil.nombre}\n\n${textoRespuestas}` }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
        ...(conPensamiento && pensamiento ? { thinkingConfig: pensamiento } : {}),
      },
    });
  };

  const llamar = async (modelo, conPensamiento) => {
    const restante = LIMITE_MS - (Date.now() - inicio);
    if (restante < 1500) return { status: 504, data: null };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), restante);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: cuerpo(modelo, conPensamiento),
          signal: ctrl.signal,
        }
      );
      const data = await resp.json().catch(() => null);
      return { status: resp.status, ok: resp.ok, data };
    } catch {
      return { status: 504, data: null };
    } finally {
      clearTimeout(t);
    }
  };

  let resultado = null;
  let ultimoError = { status: 502, msg: '' };

  for (const modelo of modelos) {
    let r = await llamar(modelo, true);
    if (r.status === 400) r = await llamar(modelo, false); // el modelo no acepta el ajuste de razonamiento
    if (r.ok) {
      try {
        const texto = (r.data?.candidates?.[0]?.content?.parts || [])
          .filter((p) => !p.thought)
          .map((p) => p.text || '').join('');
        const intento = extraerJSON(texto);
        if (Array.isArray(intento.sugerencias) && intento.sugerencias.length) { resultado = intento; break; }
      } catch { /* respuesta incompleta: probar el siguiente modelo */ }
      ultimoError = { status: 502, msg: 'respuesta incompleta' };
      continue;
    }
    ultimoError = { status: r.status, msg: r.data?.error?.message || '' };
    if (r.status === 504) break; // sin tiempo para más intentos
    // 404 (no existe), 429 (límite), 500/503 (saturado): se prueba el siguiente modelo
  }

  if (!resultado) {
    const s = ultimoError.status;
    const error =
      s === 429 ? 'La IA alcanzó su límite gratuito por ahora. Intenta de nuevo en unos minutos.'
      : s === 503 || s === 500 ? 'La IA está saturada en este momento. Espera un par de minutos y presiona "Intentar de nuevo". Tus respuestas están guardadas.'
      : s === 504 ? 'La IA tardó más de lo permitido. Presiona "Intentar de nuevo".'
      : 'No se pudo generar el perfil. Intenta de nuevo en un momento.';
    console.log('Fallo IA:', s, ultimoError.msg);
    return json(s === 429 ? 429 : 502, { error });
  }

  const { error: errGuardar } = await sb.from('resultados').upsert({
    user_id: uid, resultado, intentos: intentos + 1, generado_en: new Date().toISOString(),
  });
  if (errGuardar) return json(500, { error: 'El perfil se generó pero no se pudo guardar. Intenta de nuevo.' });

  return json(200, { resultado });
};
