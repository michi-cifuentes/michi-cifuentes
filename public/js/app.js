import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { PREGUNTAS } from './preguntas.js';

const DOMINIO = 'usuarios.michicifuentes.app'; // debe coincidir con netlify/functions/admin-usuarios.mjs
const TOTAL = PREGUNTAS.length;

let sb = null;
let perfil = null;
let respuestas = {};
let acepto = false;
let indice = 0;
let timerGuardar = null;
let usuariosAdmin = [];

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lista = (arr) => (Array.isArray(arr) ? arr : []).map((x) => `<li>${esc(x)}</li>`).join('');

function mostrar(vista) {
  document.querySelectorAll('.vista').forEach((v) => (v.hidden = v.id !== vista));
  $('barra').hidden = ['v-login', 'v-cargando'].includes(vista);
  window.scrollTo(0, 0);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3200);
}

async function token() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || '';
}

function claveAleatoria(n = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const v = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(v, (x) => abc[x % abc.length]).join('');
}

const primeraSinResponder = () => PREGUNTAS.findIndex((p) => !String(respuestas[p.id] || '').trim());

/* ---------- arranque ---------- */
async function iniciar() {
  try {
    const r = await fetch('/.netlify/functions/config');
    const c = await r.json();
    if (!c.url || !c.anonKey) throw new Error('sin config');
    sb = createClient(c.url, c.anonKey);
  } catch {
    mostrar('v-login');
    $('login-error').textContent = 'La app aún no está configurada. Revisa las variables de entorno en Netlify (paso 4 de la guía).';
    $('btn-entrar').disabled = true;
    return;
  }
  const { data } = await sb.auth.getSession();
  if (data.session) await entrar(data.session.user);
  else mostrar('v-login');
}

/* ---------- login ---------- */
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = $('login-usuario').value.trim().toLowerCase();
  const clave = $('login-clave').value;
  $('login-error').textContent = '';
  if (!u || !clave) { $('login-error').textContent = 'Escribe tu usuario y tu clave.'; return; }
  const email = u.includes('@') ? u : `${u}@${DOMINIO}`;
  $('btn-entrar').disabled = true;
  $('btn-entrar').textContent = 'Entrando…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: clave });
  $('btn-entrar').disabled = false;
  $('btn-entrar').textContent = 'Entrar';
  if (error) {
    $('login-error').textContent = /banned/i.test(error.message)
      ? 'Tu acceso está desactivado. Escribe a Michi Cifuentes para reactivarlo.'
      : 'Usuario o clave incorrectos. Revisa los datos que te enviaron.';
    return;
  }
  $('login-clave').value = '';
  await entrar(data.user);
});

$('btn-salir').addEventListener('click', async () => {
  await sb.auth.signOut();
  perfil = null; respuestas = {}; acepto = false;
  mostrar('v-login');
});

async function entrar(user) {
  mostrar('v-cargando');
  const { data: p, error } = await sb.from('perfiles').select('*').eq('id', user.id).single();
  if (error || !p) {
    await sb.auth.signOut();
    mostrar('v-login');
    $('login-error').textContent = 'Tu cuenta no tiene un perfil asignado. Escribe a Michi Cifuentes.';
    return;
  }
  perfil = p;
  $('saludo').textContent = p.nombre || p.usuario;

  if (p.rol === 'admin') return cargarAdmin();

  const { data: res } = await sb.from('resultados').select('resultado').eq('user_id', user.id).maybeSingle();
  if (res?.resultado) return verResultadoPropio(res.resultado);

  const { data: r } = await sb.from('respuestas').select('*').eq('user_id', user.id).maybeSingle();
  respuestas = r?.respuestas || {};
  acepto = !!r?.acepto_privacidad;
  if (!acepto) {
    $('intro-titulo').textContent = (p.nombre ? `Hola, ${p.nombre.split(' ')[0]}` : 'Hola');
    return mostrar('v-intro');
  }
  const i = primeraSinResponder();
  indice = i === -1 ? TOTAL - 1 : i; // si ya respondió todo, queda listo para crear el perfil
  pintarPregunta();
  mostrar('v-cuestionario');
}

/* ---------- intro ---------- */
$('chk-privacidad').addEventListener('change', (e) => ($('btn-empezar').disabled = !e.target.checked));
$('btn-empezar').addEventListener('click', async () => {
  acepto = true;
  await guardar();
  const i = primeraSinResponder();
  indice = i === -1 ? TOTAL - 1 : i; // si ya respondió todo, queda listo para crear el perfil
  pintarPregunta();
  mostrar('v-cuestionario');
});

/* ---------- cuestionario ---------- */
function pintarPregunta() {
  const p = PREGUNTAS[indice];
  $('progreso').innerHTML = PREGUNTAS.map((q, i) => {
    const cls = i === indice ? 'actual' : String(respuestas[q.id] || '').trim() ? 'hecha' : '';
    return `<span class="${cls}"></span>`;
  }).join('');
  $('q-bloque').textContent = p.bloque;
  $('q-num').innerHTML = `${indice + 1}<small>/${TOTAL}</small>`;
  $('q-num').setAttribute('aria-label', `Pregunta ${indice + 1} de ${TOTAL}`);
  $('q-texto').textContent = p.texto;
  $('q-ayuda').textContent = p.ayuda;
  $('q-respuesta').value = respuestas[p.id] || '';
  $('q-error').textContent = '';
  $('q-guardado').textContent = '';
  actualizarContador();
  $('btn-anterior').disabled = indice === 0;
  $('btn-siguiente').textContent = indice === TOTAL - 1 ? 'Crear mi perfil' : 'Siguiente';
  $('q-respuesta').focus({ preventScroll: true });
}

function actualizarContador() {
  const n = $('q-respuesta').value.length;
  $('q-contador').textContent = `${n} / 1500`;
}

async function guardar() {
  if (!perfil) return;
  const { error } = await sb.from('respuestas').upsert({
    user_id: perfil.id, respuestas, acepto_privacidad: acepto, actualizado_en: new Date().toISOString(),
  });
  $('q-guardado').textContent = error ? 'No se pudo guardar. Revisa tu conexión.' : 'Guardado';
  return !error;
}

$('q-respuesta').addEventListener('input', (e) => {
  respuestas[PREGUNTAS[indice].id] = e.target.value;
  actualizarContador();
  $('q-guardado').textContent = '';
  clearTimeout(timerGuardar);
  timerGuardar = setTimeout(guardar, 900);
});

$('btn-anterior').addEventListener('click', async () => {
  clearTimeout(timerGuardar);
  await guardar();
  if (indice > 0) { indice--; pintarPregunta(); }
});

$('btn-siguiente').addEventListener('click', async () => {
  const valor = $('q-respuesta').value.trim();
  if (valor.length < 3) { $('q-error').textContent = 'Escribe una respuesta para continuar.'; return; }
  clearTimeout(timerGuardar);
  respuestas[PREGUNTAS[indice].id] = $('q-respuesta').value;
  await guardar();
  if (indice < TOTAL - 1) { indice++; pintarPregunta(); return; }
  const falta = primeraSinResponder();
  if (falta !== -1) { indice = falta; pintarPregunta(); $('q-error').textContent = 'Te falta responder esta pregunta.'; return; }
  generar();
});

/* ---------- generar perfil ---------- */
async function generar() {
  mostrar('v-generando');
  $('gen-error').textContent = '';
  $('gen-acciones').hidden = true;
  document.querySelector('#v-generando .punto-carga').hidden = false;
  try {
    const r = await fetch('/.netlify/functions/generar-perfil', {
      method: 'POST', headers: { Authorization: `Bearer ${await token()}` },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || (r.status === 504 || r.status === 502
      ? 'La IA tardó más de lo permitido. Intenta de nuevo.' : 'No se pudo crear el perfil.'));
    verResultadoPropio(data.resultado);
  } catch (e) {
    document.querySelector('#v-generando .punto-carga').hidden = true;
    $('gen-error').textContent = e.message;
    $('gen-acciones').hidden = false;
  }
}
$('btn-reintentar').addEventListener('click', generar);
$('btn-revisar').addEventListener('click', () => { indice = 0; pintarPregunta(); mostrar('v-cuestionario'); });

/* ---------- resultado ---------- */
function htmlResultado(res, nombre) {
  const plataformas = (res.plataformas || []).map((p) =>
    typeof p === 'string' ? `<li>${esc(p)}</li>` : `<li><strong>${esc(p.nombre)}:</strong> ${esc(p.por_que)}</li>`).join('');
  const ideas = (res.sugerencias || []).map((s, i) => `
    <li class="idea">
      <div>
        <h3>${esc(s.titulo)}</h3>
        <div class="idea-meta">
          ${s.formato ? `<span class="etiqueta">${esc(s.formato)}</span>` : ''}
          ${s.plataforma ? `<span class="etiqueta">${esc(s.plataforma)}</span>` : ''}
          ${s.frecuencia ? `<span class="etiqueta">${esc(s.frecuencia)}</span>` : ''}
          ${s.objetivo ? `<span class="etiqueta etiqueta-obj">Objetivo: ${esc(s.objetivo)}</span>` : ''}
        </div>
        <p>${esc(s.descripcion)}</p>
        ${s.ejemplo ? `<div class="idea-ejemplo"><strong>Primer episodio:</strong> ${esc(s.ejemplo)}</div>` : ''}
        <div class="guia" data-guia="${i}">${s.guia ? htmlGuia(s.guia, s) : htmlGuiaEspera()}</div>
      </div>
    </li>`).join('');
  const fecha = new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <header class="res-cabecera">
      <img src="assets/avatar.jpg" alt="" class="res-foto">
      <div>
        <p class="res-para">Perfil de creador de ${esc(nombre)}</p>
        <h1 class="res-arquetipo">${esc(res.arquetipo || 'Tu perfil')}</h1>
      </div>
    </header>
    <p class="res-resumen">${esc(res.resumen)}</p>
    ${res.propuesta_valor ? `<p class="res-propuesta">${esc(res.propuesta_valor)}</p>` : ''}
    <div class="res-grid">
      <div class="res-dato"><h3>Tu nicho</h3><p>${esc(res.nicho)}</p></div>
      <div class="res-dato"><h3>Tu audiencia ideal</h3><p>${esc(res.audiencia)}</p></div>
      <div class="res-dato"><h3>Tu tono</h3><p>${esc(res.tono)}</p></div>
      <div class="res-dato"><h3>Formatos para ti</h3><ul>${lista(res.formatos)}</ul></div>
      <div class="res-dato"><h3>Dónde publicar</h3><ul>${plataformas}</ul></div>
      <div class="res-dato"><h3>Tus fortalezas</h3><ul>${lista(res.fortalezas)}</ul></div>
      <div class="res-dato"><h3>Para seguir creciendo</h3><ul>${lista(res.oportunidades)}</ul></div>
    </div>
    <h2 class="res-seccion-titulo">5 ideas de contenido para ti</h2>
    <ol class="ideas">${ideas}</ol>
    ${(res.primeros_pasos || []).length ? `<h2 class="res-seccion-titulo">Tus próximos 7 días</h2><ol class="pasos">${lista(res.primeros_pasos)}</ol>` : ''}
    <p class="pie-pdf">Michi Cifuentes · Diagnóstico de marca personal · ${esc(fecha)}</p>`;
}


/* ---------- guía paso a paso de cada idea ---------- */
const ICONO_VIDEO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>';
const ICONO_DIAPO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M2 6v12M22 6v12"/></svg>';
// Ilustración de fondo según el tipo de toma, para que cada escena se entienda de un vistazo.
function ilustracionPlano(plano, video) {
  const t = (plano || '').toLowerCase();
  if (!video) return '<svg class="ilus" viewBox="0 0 100 125" aria-hidden="true"><rect x="14" y="18" width="72" height="10" rx="3"/><rect x="14" y="36" width="54" height="6" rx="3"/><rect x="14" y="88" width="40" height="18" rx="5"/></svg>';
  if (/mano|detalle|objeto|producto|cuaderno|taza/.test(t)) return '<svg class="ilus" viewBox="0 0 100 178" aria-hidden="true"><path d="M30 150v-46a8 8 0 0 1 16 0v-22a8 8 0 0 1 16 0v18a8 8 0 0 1 16 0v50z"/><rect x="18" y="56" width="44" height="30" rx="4" transform="rotate(-12 40 71)"/></svg>';
  if (/pantalla|screen|computador|celular|app/.test(t)) return '<svg class="ilus" viewBox="0 0 100 178" aria-hidden="true"><rect x="16" y="58" width="68" height="46" rx="5"/><rect x="40" y="108" width="20" height="8"/><rect x="30" y="116" width="40" height="5" rx="2"/></svg>';
  if (/general|lugar|ambiente|caminando|exterior/.test(t)) return '<svg class="ilus" viewBox="0 0 100 178" aria-hidden="true"><path d="M0 150l28-42 18 24 16-20 38 38z"/><circle cx="74" cy="72" r="9"/></svg>';
  return '<svg class="ilus" viewBox="0 0 100 178" aria-hidden="true"><circle cx="50" cy="124" r="17"/><path d="M18 178c0-24 14-38 32-38s32 14 32 38z"/></svg>';
}
const esVideo = (formato) => /reel|video|tiktok|short|historia|story|live|vivo/i.test(formato || '');

function htmlGuiaEspera() {
  return `<div class="guia-estado"><span class="mini-carga"></span><span>En cola: tu guía paso a paso se prepara en unos segundos.</span></div>`;
}
function htmlGuiaCargando() {
  return `<div class="guia-estado"><span class="mini-carga"></span><span>Preparando la guía paso a paso, el guion visual y el texto de la publicación…</span></div>`;
}

function htmlGuia(g, idea) {
  const video = esVideo(idea?.formato);
  const cuadros = (g.guion || []).map((e, i) => `
    <figure class="cuadro">
      <div class="pantalla ${video ? 'vertical' : 'cuadrada'}">
        <span class="pantalla-num">${i + 1}</span>
        <span class="pantalla-icono">${video ? ICONO_VIDEO : ICONO_DIAPO}</span>
        ${ilustracionPlano(e.plano, video)}
        <p class="pantalla-texto">${esc(e.texto_pantalla || '')}</p>
        <span class="pantalla-plano">${esc(e.plano || '')}</span>
      </div>
      <figcaption>
        <strong>${esc(e.momento || '')}</strong>
        ${e.se_ve ? `<span><b>Se ve:</b> ${esc(e.se_ve)}</span>` : ''}
        ${e.dices ? `<span><b>${video ? 'Dices' : 'Texto'}:</b> ${esc(e.dices)}</span>` : ''}
      </figcaption>
    </figure>`).join('');

  const pasos = (g.pasos || []).map((p) => `
    <li><span class="fase">${esc(p.fase || '')}</span><span>${esc(p.accion || p)}</span></li>`).join('');

  const tags = (g.hashtags || []).map((h) => `<span class="etiqueta">${esc(h)}</span>`).join('');

  return `
    <div class="guia-cabecera">
      <h4>Guía paso a paso</h4>
      ${g.objetivo ? `<p>${esc(g.objetivo)}</p>` : ''}
      ${g.duracion ? `<span class="etiqueta">${esc(g.duracion)}</span>` : ''}
    </div>

    <h5>Guion visual</h5>
    <div class="guion-visual">${cuadros}</div>

    <h5>Cómo hacerlo</h5>
    <ol class="pasos-guia">${pasos}</ol>

    ${g.copy ? `
    <h5>Texto de la publicación</h5>
    <div class="copy-caja">
      <p class="copy-texto">${esc(g.copy)}${g.llamado_accion ? `\n\n${esc(g.llamado_accion)}` : ''}</p>
      ${tags ? `<div class="idea-meta">${tags}</div>` : ''}
      <button class="btn-texto no-imprimir" data-copiar>Copiar texto</button>
    </div>` : ''}

    <div class="guia-datos">
      ${g.cuando_publicar ? `<div><h6>Cuándo publicar</h6><p>${esc(g.cuando_publicar)}</p></div>` : ''}
      ${(g.herramientas || []).length ? `<div><h6>Herramientas</h6><ul>${lista(g.herramientas)}</ul></div>` : ''}
      ${g.como_medir ? `<div><h6>Cómo saber si funcionó</h6><p>${esc(g.como_medir)}</p></div>` : ''}
      ${(g.errores_a_evitar || []).length ? `<div><h6>Errores a evitar</h6><ul>${lista(g.errores_a_evitar)}</ul></div>` : ''}
    </div>`;
}

// Genera, una por una, las guías que falten. userId solo lo usa el admin para completar las de un cliente.
async function completarGuias(res, raiz, userId = null) {
  if (raiz._generando && raiz._res === res) return;
  raiz._res = res; // si se abre otro perfil en la misma ventana, la generación anterior se detiene
  raiz._generando = true;
  raiz.onclick = async (e) => {
    const copiar = e.target.closest('[data-copiar]');
    if (copiar) {
      const texto = copiar.closest('.copy-caja').querySelector('.copy-texto').innerText
        + '\n\n' + [...copiar.closest('.copy-caja').querySelectorAll('.etiqueta')].map((t) => t.innerText).join(' ');
      try { await navigator.clipboard.writeText(texto.trim()); toast('Texto copiado'); } catch { toast('Selecciona el texto y cópialo manualmente'); }
    }
    if (e.target.closest('[data-reintentar]')) completarGuias(res, raiz, userId);
  };
  try {
    const ideas = res.sugerencias || [];
    for (let i = 0; i < ideas.length; i++) {
      if (raiz._res !== res) return;
      if (ideas[i].guia) continue;
      const cont = raiz.querySelector(`[data-guia="${i}"]`);
      if (!cont) continue;
      cont.innerHTML = htmlGuiaCargando();
      try {
        const r = await fetch('/.netlify/functions/detallar-idea', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
          body: JSON.stringify({ indice: i, user_id: userId }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || (r.status >= 500 ? 'La IA tardó más de lo permitido.' : 'No se pudo preparar la guía.'));
        ideas[i].guia = data.guia;
        cont.innerHTML = htmlGuia(data.guia, ideas[i]);
      } catch (err) {
        cont.innerHTML = `<div class="guia-estado guia-error"><span>${esc(err.message)}</span>
          <button class="btn-sec no-imprimir" data-reintentar>Reintentar guía</button></div>`;
        break; // si la IA está saturada, las siguientes también fallarían: se espera al reintento
      }
    }
  } finally {
    if (raiz._res === res) raiz._generando = false;
  }
}

function verResultadoPropio(res) {
  $('resultado-contenido').innerHTML = htmlResultado(res, perfil.nombre || perfil.usuario);
  mostrar('v-resultado');
  completarGuias(res, $('resultado-contenido'));
}

function imprimir(nombre) {
  const t = document.title;
  document.title = `Perfil de creador - ${nombre} - Michi Cifuentes`;
  window.print();
  document.title = t;
}

$('btn-pdf').addEventListener('click', () => imprimir(perfil.nombre || perfil.usuario));

function htmlRespuestas(r) {
  return PREGUNTAS.map((p, i) => `
    <div class="respuesta-item">
      <h3>${i + 1}. ${esc(p.texto)}</h3>
      <p>${esc(r?.[p.id] || 'Sin responder')}</p>
    </div>`).join('');
}

$('btn-ver-respuestas').addEventListener('click', async () => {
  const { data } = await sb.from('respuestas').select('respuestas').eq('user_id', perfil.id).maybeSingle();
  abrirDialogo('Tus respuestas', htmlRespuestas(data?.respuestas));
});

/* ---------- diálogo ---------- */
function abrirDialogo(titulo, html) {
  $('dialogo-titulo').textContent = titulo;
  $('dialogo-cuerpo').innerHTML = html;
  $('dialogo').showModal();
}
$('dialogo-cerrar').addEventListener('click', () => $('dialogo').close());
window.addEventListener('afterprint', () => document.body.classList.remove('imprimiendo-dialogo'));

/* ---------- administración ---------- */
async function api(accion, datos = {}) {
  const r = await fetch('/.netlify/functions/admin-usuarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ accion, ...datos }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'No se pudo completar la acción.');
  return data;
}

async function cargarAdmin() {
  mostrar('v-admin');
  try {
    const { usuarios } = await api('listar');
    usuariosAdmin = usuarios;
    pintarTabla();
  } catch (e) {
    toast(e.message);
  }
}

function pintarTabla() {
  const clientes = usuariosAdmin;
  $('admin-vacio').hidden = clientes.some((u) => u.rol !== 'admin');
  $('tabla-usuarios').innerHTML = clientes.map((u) => {
    const yo = u.id === perfil.id;
    const fecha = new Date(u.creado_en).toLocaleDateString('es');
    const avance = u.rol === 'admin' ? '—' : u.tiene_resultado ? 'Perfil listo' : `${u.contestadas} de ${TOTAL}`;
    const estado = u.rol === 'admin'
      ? '<span class="estado admin">Administrador</span>'
      : u.activo ? '<span class="estado on">Activo</span>' : '<span class="estado off">Desactivado</span>';
    const acciones = [
      u.rol !== 'admin' && (u.contestadas > 0 || u.tiene_resultado) ? `<button class="btn-texto" data-acc="ver" data-id="${u.id}">Ver</button>` : '',
      `<button class="btn-texto" data-acc="clave" data-id="${u.id}">Cambiar clave</button>`,
      !yo ? `<button class="btn-texto" data-acc="estado" data-id="${u.id}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : '',
      u.tiene_resultado ? `<button class="btn-texto" data-acc="reiniciar" data-id="${u.id}">Permitir rehacer</button>` : '',
      !yo ? `<button class="btn-texto btn-peligro" data-acc="eliminar" data-id="${u.id}">Eliminar</button>` : '',
    ].join('');
    return `<tr>
      <td><div class="nombre">${esc(u.nombre)}</div><div class="nota">Desde ${fecha}</div></td>
      <td>${esc(u.usuario)}</td>
      <td>${avance}</td>
      <td>${estado}</td>
      <td><div class="acciones">${acciones}</div></td>
    </tr>`;
  }).join('');
}

function mostrarCredenciales(nombre, usuario, clave, titulo) {
  const texto = `Hola ${nombre.split(' ')[0]}, este es tu acceso al diagnóstico de marca personal de Michi Cifuentes:\n\nEnlace: ${location.origin}\nUsuario: ${usuario}\nClave: ${clave}`;
  const box = $('credenciales');
  box.innerHTML = `<strong>${esc(titulo)}</strong> Copia este mensaje y envíaselo a la persona. Por seguridad, la clave no se vuelve a mostrar.
    <pre id="cred-texto">${esc(texto)}</pre>
    <button class="btn-sec" id="btn-copiar">Copiar mensaje</button>`;
  box.hidden = false;
  $('btn-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(texto); toast('Mensaje copiado'); }
    catch { toast('Selecciona el texto y cópialo manualmente'); }
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('btn-generar-clave').addEventListener('click', () => ($('c-clave').value = claveAleatoria()));

$('form-crear').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = $('c-nombre').value.trim();
  const usuario = $('c-usuario').value.trim().toLowerCase();
  const clave = $('c-clave').value;
  $('c-error').textContent = '';
  if (!nombre || !usuario || !clave) { $('c-error').textContent = 'Completa nombre, usuario y clave.'; return; }
  $('btn-crear').disabled = true;
  try {
    await api('crear', { nombre, usuario, clave });
    mostrarCredenciales(nombre, usuario, clave, 'Acceso creado.');
    e.target.reset();
    const { usuarios } = await api('listar');
    usuariosAdmin = usuarios; pintarTabla();
  } catch (err) {
    $('c-error').textContent = err.message;
  } finally {
    $('btn-crear').disabled = false;
  }
});

$('tabla-usuarios').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-acc]');
  if (!b) return;
  const u = usuariosAdmin.find((x) => x.id === b.dataset.id);
  if (!u) return;
  const acc = b.dataset.acc;

  try {
    if (acc === 'ver') return verCliente(u);

    if (acc === 'clave') {
      const nueva = prompt(`Nueva clave para ${u.nombre} (mínimo 8 caracteres):`, claveAleatoria());
      if (!nueva) return;
      await api('clave', { id: u.id, clave: nueva });
      if (u.rol === 'admin') toast('Clave actualizada');
      else mostrarCredenciales(u.nombre, u.usuario, nueva, 'Clave actualizada.');
      return;
    }

    if (acc === 'estado') {
      const activar = !u.activo;
      if (!activar && !confirm(`¿Desactivar el acceso de ${u.nombre}? No podrá entrar hasta que lo actives de nuevo.`)) return;
      await api('estado', { id: u.id, activo: activar });
      toast(activar ? 'Acceso activado' : 'Acceso desactivado');
    }

    if (acc === 'reiniciar') {
      if (!confirm(`¿Permitir que ${u.nombre} vuelva a crear su perfil? Se borra el perfil actual y se conservan sus respuestas para que pueda editarlas.`)) return;
      await api('reiniciar', { id: u.id });
      toast('Listo: puede rehacer su perfil');
    }

    if (acc === 'eliminar') {
      if (!confirm(`¿Eliminar a ${u.nombre}? Se borran su acceso, sus respuestas y su perfil. Esta acción no se puede deshacer.`)) return;
      await api('eliminar', { id: u.id });
      toast('Cliente eliminado');
    }

    const { usuarios } = await api('listar');
    usuariosAdmin = usuarios; pintarTabla();
  } catch (err) {
    toast(err.message);
  }
});

async function verCliente(u) {
  const [{ data: r }, { data: o }] = await Promise.all([
    sb.from('respuestas').select('respuestas').eq('user_id', u.id).maybeSingle(),
    sb.from('resultados').select('resultado').eq('user_id', u.id).maybeSingle(),
  ]);
  let html = '';
  if (o?.resultado) {
    html += `<div class="no-imprimir" style="margin-bottom:1.5rem"><button class="btn" id="btn-pdf-cliente">Descargar perfil en PDF</button></div>`;
    html += htmlResultado(o.resultado, u.nombre);
  } else {
    html += `<p class="sub">${esc(u.nombre)} todavía no genera su perfil. Lleva ${u.contestadas} de ${TOTAL} respuestas.</p>`;
  }
  html += `<div class="no-imprimir"><h2 style="margin-top:2rem">Respuestas</h2>${htmlRespuestas(r?.respuestas)}</div>`;
  abrirDialogo(u.nombre, html);
  if (o?.resultado) completarGuias(o.resultado, $('dialogo-cuerpo'), u.id);
  $('btn-pdf-cliente')?.addEventListener('click', () => {
    document.body.classList.add('imprimiendo-dialogo');
    imprimir(u.nombre);
  });
}

iniciar();
