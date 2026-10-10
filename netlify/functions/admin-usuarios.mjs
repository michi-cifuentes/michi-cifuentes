// Gestión de usuarios: solo la puede usar una cuenta con rol "admin".
import { createClient } from '@supabase/supabase-js';

const DOMINIO = 'usuarios.michicifuentes.app'; // dominio interno: los clientes solo usan "usuario"

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Verificar que quien llama es admin
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  const { data: quien, error: errQuien } = await sb.auth.getUser(token);
  if (errQuien || !quien?.user) return json(401, { error: 'Sesión no válida. Vuelve a iniciar sesión.' });

  const { data: perfilAdmin } = await sb.from('perfiles').select('rol').eq('id', quien.user.id).single();
  if (perfilAdmin?.rol !== 'admin') return json(403, { error: 'Solo el administrador puede hacer esto.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Solicitud inválida' }); }
  const { accion } = body;

  try {
    if (accion === 'listar') {
      const { data: perfiles, error } = await sb
        .from('perfiles').select('id, usuario, nombre, rol, activo, creado_en')
        .order('creado_en', { ascending: false });
      if (error) throw error;
      const { data: res } = await sb.from('respuestas').select('user_id, respuestas');
      const { data: out } = await sb.from('resultados').select('user_id, generado_en, intentos');
      const lista = perfiles.map((p) => {
        const r = res?.find((x) => x.user_id === p.id);
        const o = out?.find((x) => x.user_id === p.id);
        const contestadas = r ? Object.values(r.respuestas || {}).filter((v) => String(v).trim()).length : 0;
        return { ...p, contestadas, tiene_resultado: !!o, generado_en: o?.generado_en || null, intentos: o?.intentos || 0 };
      });
      return json(200, { usuarios: lista });
    }

    if (accion === 'crear') {
      const usuario = String(body.usuario || '').trim().toLowerCase();
      const nombre = String(body.nombre || '').trim();
      const clave = String(body.clave || '');
      if (!/^[a-z0-9._-]{3,30}$/.test(usuario))
        return json(400, { error: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios.' });
      if (clave.length < 8) return json(400, { error: 'La clave debe tener al menos 8 caracteres.' });
      if (!nombre) return json(400, { error: 'Escribe el nombre de la persona.' });

      const { error } = await sb.auth.admin.createUser({
        email: `${usuario}@${DOMINIO}`,
        password: clave,
        email_confirm: true,
        user_metadata: { usuario, nombre },
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return json(409, { error: 'Ese usuario ya existe. Elige otro.' });
        throw error;
      }
      return json(200, { ok: true });
    }

    const id = body.id;
    if (!id) return json(400, { error: 'Falta el usuario.' });
    if (id === quien.user.id && ['estado', 'eliminar'].includes(accion))
      return json(400, { error: 'No puedes desactivar ni eliminar tu propia cuenta de administrador.' });

    if (accion === 'clave') {
      if (String(body.clave || '').length < 8) return json(400, { error: 'La clave debe tener al menos 8 caracteres.' });
      const { error } = await sb.auth.admin.updateUserById(id, { password: body.clave });
      if (error) throw error;
      return json(200, { ok: true });
    }

    if (accion === 'estado') {
      const activo = !!body.activo;
      const { error } = await sb.auth.admin.updateUserById(id, { ban_duration: activo ? 'none' : '876000h' });
      if (error) throw error;
      await sb.from('perfiles').update({ activo }).eq('id', id);
      return json(200, { ok: true });
    }

    if (accion === 'reiniciar') {
      await sb.from('resultados').delete().eq('user_id', id);
      if (body.borrarRespuestas) await sb.from('respuestas').delete().eq('user_id', id);
      return json(200, { ok: true });
    }

    if (accion === 'eliminar') {
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(400, { error: 'Acción desconocida' });
  } catch (e) {
    return json(500, { error: 'Error del servidor: ' + (e.message || e) });
  }
};
