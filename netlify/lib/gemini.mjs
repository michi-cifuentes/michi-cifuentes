// Llamadas a Google Gemini con modelos de respaldo y control de tiempo.
// Netlify corta las funciones gratuitas cerca de los 10 segundos, por eso cada llamada respeta un límite.

export function extraerJSON(texto) {
  const limpio = String(texto || '').replace(/```json|```/g, '').trim();
  const ini = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  return JSON.parse(limpio.slice(ini, fin + 1));
}

function ajustePensamiento(modelo) {
  if (/gemini-2\.5/.test(modelo)) return { thinkingBudget: 0 };
  if (/gemini-3/.test(modelo)) return { thinkingLevel: 'low' };
  return null;
}

/**
 * Pide a Gemini un objeto JSON. Prueba los modelos en orden hasta que uno responda bien.
 * @returns {Promise<{ok: true, data: object, modelo: string} | {ok: false, status: number, msg: string}>}
 */
export async function pedirJSON({ instrucciones, mensaje, modelos, maxTokens = 4000, limiteMs = 9300, validar = () => true }) {
  const inicio = Date.now();
  const lista = [...new Set(modelos.filter(Boolean))];
  let ultimo = { status: 502, msg: '' };

  const llamar = async (modelo, conPensamiento) => {
    const restante = limiteMs - (Date.now() - inicio);
    if (restante < 1500) return { status: 504 };
    const pensamiento = ajustePensamiento(modelo);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), restante);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instrucciones }] },
            contents: [{ role: 'user', parts: [{ text: mensaje }] }],
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: maxTokens,
              responseMimeType: 'application/json',
              ...(conPensamiento && pensamiento ? { thinkingConfig: pensamiento } : {}),
            },
          }),
          signal: ctrl.signal,
        }
      );
      const data = await resp.json().catch(() => null);
      return { status: resp.status, ok: resp.ok, data };
    } catch {
      return { status: 504 };
    } finally {
      clearTimeout(t);
    }
  };

  for (const modelo of lista) {
    let r = await llamar(modelo, true);
    if (r.status === 400) r = await llamar(modelo, false); // el modelo no acepta el ajuste de razonamiento
    if (r.ok) {
      try {
        const texto = (r.data?.candidates?.[0]?.content?.parts || [])
          .filter((p) => !p.thought)
          .map((p) => p.text || '').join('');
        const obj = extraerJSON(texto);
        if (validar(obj)) return { ok: true, data: obj, modelo };
      } catch { /* respuesta incompleta: se prueba el siguiente modelo */ }
      ultimo = { status: 502, msg: 'respuesta incompleta' };
      continue;
    }
    ultimo = { status: r.status, msg: r.data?.error?.message || '' };
    if (r.status === 504) break; // sin tiempo para más intentos
    // 404 (no existe), 429 (límite), 500/503 (saturado): se prueba el siguiente modelo
  }
  console.log('Fallo IA:', ultimo.status, ultimo.msg);
  return { ok: false, ...ultimo };
}

export function mensajeError(status) {
  if (status === 429) return 'La IA alcanzó su límite gratuito por ahora. Intenta de nuevo en unos minutos.';
  if (status === 503 || status === 500) return 'La IA está saturada en este momento. Espera un par de minutos y presiona "Intentar de nuevo". Tus respuestas están guardadas.';
  if (status === 504) return 'La IA tardó más de lo permitido. Presiona "Intentar de nuevo".';
  return 'No se pudo generar el contenido. Intenta de nuevo en un momento.';
}
