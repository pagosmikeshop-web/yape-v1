# Gateway de Telegram en VPS

Este servicio recibe el webhook del **mismo bot administrador**, confirma al instante los updates irrelevantes y reenvía solamente `/redeem` y `/me` a Vercel mediante HMAC. No crea un segundo bot.

## Variables del VPS

Copiar `gateway.env.example` a `.env` y completar:

- `TELEGRAM_BOT_TOKEN`: token del bot actual.
- `TELEGRAM_WEBHOOK_SECRET`: secreto de Telegram hacia el VPS. Generar con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- `TELEGRAM_VPS_FORWARD_SECRET`: segundo secreto independiente para VPS hacia Vercel; generar del mismo modo.
- `VERCEL_COMMAND_URL`: URL productiva exacta de la ruta interna.
- `TELEGRAM_VPS_WEBHOOK_URL`: subdominio HTTPS del VPS, terminado en `/telegram/webhook`.

## Despliegue

1. Crear un registro DNS `A` para `bot.yape.pro` hacia la IP del VPS.
2. Instalar Caddy en el VPS y copiar `Caddyfile.example` como `/etc/caddy/Caddyfile`; ajustar el dominio si corresponde y reiniciar Caddy. Caddy obtiene TLS automáticamente.
3. Copiar esta carpeta al VPS, por ejemplo a `/opt/yape-telegram-gateway`, y copiar `gateway.env.example` a `.env` allí.
4. Ejecutar `pm2 startOrReload ecosystem.config.cjs --only yape-telegram-gateway` y después `pm2 save`.
5. Comprobar `curl https://bot.yape.pro/health`; debe responder `{ "ok": true }`.

El proceso usa el nombre aislado `yape-telegram-gateway`; PM2 no detiene ni reinicia los demás bots.

## Variables en Vercel

Antes de cambiar el webhook, configurar en **Production**:

- `TELEGRAM_MEMBERSHIP_BOT_TOKEN`: el mismo token del bot actual. Se conserva para `getChatMember` de la PWA.
- `TELEGRAM_VPS_FORWARD_SECRET`: exactamente el mismo valor configurado en el VPS.

No pongas `TELEGRAM_VPS_FORWARD_SECRET` hasta que el gateway y su HTTPS funcionen. Conserva las variables antiguas hasta completar la prueba; luego las credenciales de comandos ya no son necesarias en Vercel.

## Cambio del webhook

Cuando `/health` responda por HTTPS y las variables de Vercel estén desplegadas, desde esta carpeta en el VPS:

```sh
node configure-webhook.mjs
```

No ejecutar `/api/telegram/setup` después: esa ruta volvería a apuntar el webhook a Vercel. El script no descarta updates pendientes.

## Flujo y protecciones

```text
Telegram -> VPS (/telegram/webhook, secret de Telegram)
         -> 200 inmediato para mensajes no relevantes
         -> HMAC con timestamp para /redeem y /me
VPS -> Vercel (/api/internal/telegram/command)
Vercel -> devuelve respuesta de comando sin token del bot
VPS -> Telegram sendMessage
```

La firma HMAC caduca a los 90 segundos. El gateway conserva brevemente la respuesta de un update para reintentar el envío sin repetir el comando si Telegram reintenta una entrega fallida.
