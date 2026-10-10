---
description: Auditoría de seguridad (OWASP, secretos, dependencias, headers, Supabase, Vercel, integraciones, plugins) con corrección en rama
argument-hint: [fix|audit|verify] [--offline] [--zap] [url-base]
---
Activá la skill `security-audit-loop`. Modo por defecto: **fix** en rama `audit/<fecha>`. Respetá las reglas de oro (hosts permitidos, solo GET/HEAD, sin exploits, secretos se rotan, nada en producción). Argumentos: $ARGUMENTS
