# Michi Cifuentes · Perfil de creador de contenido

Miniapp donde cada cliente responde 15 preguntas y recibe, generado con IA, su perfil de marca personal y 5 ideas de contenido. Tú eres el único administrador: creas los usuarios y claves, y nadie más puede registrarse.

Todo funciona con planes gratuitos: **Netlify** (alojamiento), **Supabase** (base de datos, inicio de sesión y seguridad) y **Google Gemini** (inteligencia artificial).

## Contenido de la carpeta

| Archivo | Para qué sirve |
|---|---|
| `public/` | La app que ve la gente (pantallas, estilos, fotos) |
| `public/js/preguntas.js` | Las 15 preguntas. Edítalas aquí si quieres cambiarlas |
| `public/assets/` | `avatar.jpg` (foto redonda) y `portada.jpg` (foto del inicio de sesión) |
| `netlify/functions/` | Funciones del servidor: crear usuarios, llamar a la IA |
| `supabase/schema.sql` | Script que crea las tablas y los permisos |
| `netlify.toml`, `package.json` | Configuración para Netlify |

---

## Paso 1 · Crear la base de datos en Supabase

1. Entra a [supabase.com](https://supabase.com), crea una cuenta gratuita y luego **New project**. Ponle de nombre `michi-cifuentes`, elige una contraseña para la base de datos (guárdala) y la región más cercana.
2. Cuando el proyecto esté listo, ve a **SQL Editor → New query**, pega todo el contenido de `supabase/schema.sql` y presiona **Run**.
3. Ve a **Authentication → Sign In / Providers** y **desactiva** la opción *Allow new users to sign up*. Esto impide que alguien se registre por su cuenta.
4. Crea tu usuario de administrador: **Authentication → Users → Add user → Create new user**. Usa tu correo real y una clave segura, y marca **Auto Confirm User**.
5. Vuelve a **SQL Editor** y ejecuta esto, con tu correo:
   ```sql
   update public.perfiles set rol = 'admin', nombre = 'Sergio'
   where id = (select id from auth.users where email = 'TU_CORREO@ejemplo.com');
   ```
6. Ve a **Project Settings → API Keys** (o **Data API**) y copia tres datos:
   - **Project URL**
   - **anon / publishable key** (clave pública)
   - **service_role / secret key** (clave secreta: nunca la compartas ni la pegues en el código)

## Paso 2 · Obtener la clave gratuita de la IA

1. Entra a [aistudio.google.com](https://aistudio.google.com) con una cuenta de Google.
2. Haz clic en **Get API key → Create API key** y cópiala.

> En el plan gratuito, Google puede usar los datos enviados para mejorar sus productos. Por eso la app muestra un aviso de privacidad que el cliente acepta antes de empezar. Si más adelante activas facturación en Google AI Studio, esto deja de aplicar y el costo por perfil es de centavos.

## Paso 3 · Subir el código a GitHub

1. Crea una cuenta en [github.com](https://github.com) y un repositorio nuevo, privado, llamado `michi-cifuentes`.
2. En el repositorio, elige **Add file → Upload files** y arrastra **el contenido** de esta carpeta (no la carpeta `node_modules` si existe). Confirma con **Commit changes**.

## Paso 4 · Publicar en Netlify

1. Entra a [netlify.com](https://netlify.com), crea una cuenta gratuita (puedes usar tu cuenta de GitHub).
2. **Add new project → Import an existing project → GitHub** y elige el repositorio `michi-cifuentes`. Netlify lee la configuración solo; no cambies nada y continúa.
3. Antes o después del primer despliegue, ve a **Project configuration → Environment variables** y agrega:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL de Supabase |
   | `SUPABASE_ANON_KEY` | Clave pública (anon / publishable) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta (service_role / secret) |
   | `GEMINI_API_KEY` | Clave de Google AI Studio |
   | `GEMINI_MODEL` | Opcional. Por defecto `gemini-2.5-flash` |

4. Ve a **Deploys → Trigger deploy → Deploy project** para que tome las variables.
5. Cambia la dirección en **Project configuration → Change project name** a `michicifuentes`. Tu app quedará en `https://michicifuentes.netlify.app` (si el nombre está libre).

## Paso 5 · Usarla

- **Tú entras** con tu correo completo y tu clave. Verás el panel de clientes.
- **Para dar acceso a alguien**: escribe su nombre, un usuario (por ejemplo `ana.perez`) y una clave (el botón *Generar* crea una segura). La app te muestra un mensaje listo para copiar y enviarle por WhatsApp o correo.
- **El cliente entra** solo con su usuario y clave, acepta el aviso, responde y recibe su perfil. Puede descargarlo en PDF con el botón *Descargar en PDF* (se abre la ventana de impresión: elige *Guardar como PDF*).
- **Desde el panel puedes**: ver respuestas y perfiles, descargar el PDF de cualquier cliente, cambiar claves, desactivar o activar accesos, permitir que alguien rehaga su perfil y eliminar clientes.

## Cambios comunes

- **Cambiar las fotos**: reemplaza `public/assets/avatar.jpg` y `public/assets/portada.jpg` por otras con el mismo nombre y sube los cambios a GitHub. Netlify se actualiza solo.
- **Cambiar las preguntas**: edita `public/js/preguntas.js`.
- **Cambiar cuántas veces puede generar cada cliente**: `MAX_INTENTOS` en `netlify/functions/generar-perfil.mjs` (por defecto 3).

## Límites del plan gratuito

- **Gemini** tiene límites de solicitudes por minuto y por día. Si se alcanzan, la app le pide al cliente intentar en unos minutos.
- **Netlify** da unos 10 segundos a cada función. La IA está configurada para responder rápido; si alguna vez se pasa del tiempo, el cliente ve *Intentar de nuevo* y sus respuestas no se pierden.
- **Supabase** pausa los proyectos gratuitos tras 7 días sin uso. Si pasa, entra a supabase.com y presiona **Restore project**.
- Haz un respaldo de vez en cuando desde Supabase: **Table Editor → respuestas / resultados → Export to CSV**.

## Seguridad incluida

- Registro público desactivado: solo el administrador crea cuentas, desde una función del servidor que verifica el rol.
- Permisos en la base de datos (RLS): cada cliente solo puede ver y editar lo suyo; el administrador ve todo.
- Las claves secretas viven solo en Netlify, nunca en el navegador.
- Los usuarios desactivados no pueden iniciar sesión.
