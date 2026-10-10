---
name: supabase-rls-audit
description: Auditoría de seguridad de Supabase (RLS, políticas, advisors, storage, funciones, Edge Functions, claves) en modo solo lectura. Usar en proyectos con Supabase antes de producción o ante cualquier duda de control de acceso.
---

# Supabase — auditoría de solo lectura

Preferí un proyecto de **desarrollo/branch**. Si el MCP de Supabase está conectado, usalo en modo solo lectura (verificá la opción vigente en su documentación). **Nunca** `apply_migration`, `execute_sql` mutante, `create/delete_branch`, `pause_project` ni secretos de Edge Functions sin orden explícita del usuario.

## Pasos
1. **Advisors**: `get_advisors` de seguridad y de rendimiento. Cada advisor es un hallazgo con su URL de remediación.
2. **Tablas sin RLS**: `list_tables` (esquema `public`) o:
   ```sql
   select schemaname, tablename from pg_tables where schemaname = 'public' and not rowsecurity;
   ```
   Toda tabla expuesta por la API con datos de personas **debe** tener RLS. Tabla sin RLS con datos = **P0**.
3. **Políticas permisivas**:
   ```sql
   select tablename, policyname, cmd, roles, qual, with_check from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true' or roles @> '{anon}');
   ```
   `using (true)` en tablas con datos de usuarios = P0/P1 según la tabla.
4. **Funciones `SECURITY DEFINER`** expuestas:
   ```sql
   select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef;
   ```
   Deben fijar `search_path` y no ser invocables por `anon` si no corresponde.
5. **Storage**: `select id, public from storage.buckets where public;` — un bucket público con documentos privados (DNI, comprobantes) es P0.
6. **Código**: las políticas no se apoyan en `user_metadata` (lo edita el usuario; usar `app_metadata` o tablas de roles); `(select auth.uid())` por rendimiento; vistas con `security_invoker`; `service_role` solo en servidor y jamás en componentes de cliente; la clave `anon` es pública **solo si RLS está bien**; Edge Functions con verificación de JWT salvo webhooks (que verifican firma).
7. **Perfiles**: cruzá con la matriz de acceso (`accessChecks` de `ui-audit.journeys.json`): lo que la UI oculta a un perfil también debe estar bloqueado por RLS.

## Fix
Solo como **archivos de migración** en la rama (`supabase/migrations/<timestamp>_<nombre>.sql`) con explicación y plan de rollback. El usuario las revisa y las aplica (acción humana en el reporte).
