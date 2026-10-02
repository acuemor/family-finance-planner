# Family Finance Planner v3.1

## Cambio
- La opción **Miembros** solo se muestra al administrador del hogar.
- Los miembros que no son administradores no pueden abrir esa sección desde la navegación.
- Se añade una comprobación adicional en el manejador del formulario antes de llamar al RPC.

## Seguridad en Supabase
La función `public.add_existing_user_to_household` de la migración 003 ya comprueba `public.is_household_owner(p_household_id)` en el servidor. Por tanto, aunque un miembro intente invocar directamente el RPC desde el navegador, Supabase debe rechazarlo.

No hay que ejecutar ninguna migración SQL adicional para este ajuste de interfaz. La autorización del servidor sigue siendo la protección efectiva; ocultar la opción en el frontend es solo una mejora de experiencia de usuario.
