-- =====================================================================
-- Michi Cifuentes · Perfil de creadores de contenido
-- Ejecuta este script completo en Supabase > SQL Editor > New query
-- =====================================================================

-- 1. Perfiles de usuario (uno por cada cuenta creada por el admin)
create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  usuario     text unique,
  nombre      text,
  rol         text not null default 'cliente' check (rol in ('admin', 'cliente')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- 2. Respuestas del cuestionario (se guardan a medida que el cliente avanza)
create table if not exists public.respuestas (
  user_id            uuid primary key references public.perfiles(id) on delete cascade,
  respuestas         jsonb not null default '{}'::jsonb,
  acepto_privacidad  boolean not null default false,
  actualizado_en     timestamptz not null default now()
);

-- 3. Resultado generado por la IA (solo lo escribe el servidor)
create table if not exists public.resultados (
  user_id      uuid primary key references public.perfiles(id) on delete cascade,
  resultado    jsonb,
  intentos     int not null default 0,
  generado_en  timestamptz not null default now()
);

-- Función auxiliar: ¿el usuario conectado es admin?
create or replace function public.es_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

-- Crear el perfil automáticamente cuando se crea un usuario
create or replace function public.nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, usuario, nombre)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'usuario', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'nombre',  split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- ---------------------------------------------------------------------
-- Seguridad a nivel de fila (RLS)
-- Los clientes solo ven lo suyo; el admin ve todo.
-- Nadie puede crear usuarios ni cambiar roles desde el navegador.
-- ---------------------------------------------------------------------
alter table public.perfiles   enable row level security;
alter table public.respuestas enable row level security;
alter table public.resultados enable row level security;

drop policy if exists "ver perfil propio o admin" on public.perfiles;
create policy "ver perfil propio o admin" on public.perfiles
  for select using (id = auth.uid() or public.es_admin());

drop policy if exists "ver respuestas propias o admin" on public.respuestas;
create policy "ver respuestas propias o admin" on public.respuestas
  for select using (user_id = auth.uid() or public.es_admin());

drop policy if exists "crear respuestas propias" on public.respuestas;
create policy "crear respuestas propias" on public.respuestas
  for insert with check (user_id = auth.uid());

drop policy if exists "editar respuestas propias" on public.respuestas;
create policy "editar respuestas propias" on public.respuestas
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "ver resultado propio o admin" on public.resultados;
create policy "ver resultado propio o admin" on public.resultados
  for select using (user_id = auth.uid() or public.es_admin());

-- =====================================================================
-- DESPUÉS de crear tu usuario admin en Authentication > Users,
-- ejecuta esta línea cambiando el correo por el tuyo:
--
--   update public.perfiles set rol = 'admin', nombre = 'Sergio'
--   where id = (select id from auth.users where email = 'TU_CORREO@ejemplo.com');
-- =====================================================================
