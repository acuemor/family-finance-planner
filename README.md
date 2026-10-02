# Family Finance Planner

Aplicación web responsive en HTML/CSS/JavaScript ES Modules, con Supabase Auth y PostgreSQL/RLS.

## Funcionalidades de esta versión

- Inicio de sesión y registro con Supabase Auth.
- Creación inicial del hogar familiar.
- Alta de un miembro que ya se haya registrado y confirmado su correo en Supabase Auth. Solo el administrador puede vincularlo.
- Miembros con cuentas de acceso independientes y datos compartidos dentro del mismo hogar.
- Ingresos habituales por miembro, con importe mensual por defecto y edición de la plantilla.
- Ingresos extraordinarios/puntuales que solo afectan al mes seleccionado.
- Copia automática de las plantillas de ingresos a los meses nuevos, sin duplicarlas ni sobrescribir ajustes existentes.
- Ajuste del importe previsto en un mes concreto sin modificar la plantilla ni otros meses.
- Desactivación de plantillas para que dejen de copiarse a futuros meses. Los meses ya generados conservan su fotografía.
- Resumen mensual, partidas presupuestarias, cuentas y movimientos.

## 1. Actualizar los archivos

1. Haz una copia de seguridad de tu carpeta local actual.
2. Sustituye los archivos de la aplicación por los de esta versión.
3. Conserva tu `supabase-config.js` actual: contiene la URL y la clave pública de tu proyecto. No lo sustituyas por el archivo de ejemplo si ya está configurado.
4. No borres ni reinicialices los datos de Supabase.

## 2. Aplicar la migración de Supabase

1. Abre el proyecto `family-finance-planner` en Supabase.
2. Entra en **SQL Editor** y crea una consulta nueva.
3. Ejecuta únicamente `supabase-migration-004-extraordinary-incomes.sql`.
4. La migración 003 ya se aplicó en la versión anterior; no vuelvas a ejecutarla ni vuelvas a ejecutar el esquema inicial. La migración 004 añade el tipo de ingreso y actualiza la función de copia de plantillas.

La función para añadir miembros busca el usuario en `auth.users` en el servidor; el navegador no recibe acceso a esa tabla. Solo permite vincular una cuenta cuyo email esté confirmado, que aún no pertenezca a otro hogar y cuando la llamada la realiza el administrador del hogar.

## 3. Crear y vincular a la segunda persona

1. Cierra tu sesión.
2. En la pantalla de acceso, pulsa **Crear cuenta** y registra el correo de la otra persona.
3. Si Supabase solicita confirmación de email, la persona debe abrir el correo y confirmar la cuenta.
4. Vuelve a iniciar sesión con tu cuenta de administrador.
5. Abre **Miembros**, introduce el mismo correo confirmado y el nombre que quieres mostrar.
6. Pulsa **Añadir al hogar**. La persona aparecerá en el listado y podrá iniciar sesión con sus propias credenciales.

No compartas contraseñas. No es necesario crear una segunda familia para la otra persona.

## 4. Configurar ingresos habituales

1. Abre **Ingresos**.
2. Selecciona el miembro al que corresponde el ingreso.
3. Introduce el concepto (por ejemplo, Nómina) y el importe mensual habitual.
4. Pulsa **Guardar habitual**.

La plantilla se aplica desde el mes seleccionado en el selector superior y a los meses posteriores mientras esté activa. Al consultar un mes, la aplicación copia los ingresos aplicables si todavía no existen. Puedes editar el importe habitual de la plantilla; ese cambio solo afecta a meses futuros que aún no se hayan preparado. Para modificar un único mes, utiliza **Ajustar** en el ingreso de la fotografía mensual. También puedes añadir ingresos extraordinarios desde el formulario correspondiente: solo se guardan en el mes seleccionado y no se copian. Desactivar una plantilla evita que se copie a meses futuros, sin borrar registros históricos.

## 5. Ejecutar en local

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000`.

## Seguridad y notas

- Mantén activada la confirmación de email en Supabase Auth.
- Nunca utilices la clave `service_role` en el navegador ni la subas a GitHub.
- Las tablas financieras siguen aisladas por hogar mediante RLS.
- Los importes mensuales son fotografías independientes. Cambiar una plantilla no altera meses ya generados.
- La creación automática del plan mensual se realiza mediante una función SQL transaccional y comprueba la pertenencia al hogar.
- Antes de introducir información financiera real, prueba el alta del segundo usuario y la creación/ajuste de ingresos con importes ficticios.


## Versión 5 · Gastos, fondos y ahorros

Después de actualizar los archivos, ejecuta `supabase-migration-005-budget-templates.sql` una sola vez, después de las migraciones 003 y 004. La sección Presupuesto permite crear plantillas habituales y partidas puntuales. Las plantillas se copian a los meses abiertos al consultarlos; los meses cerrados y las partidas ya creadas no se sobrescriben. Para los fondos acumulativos se registra una aportación mensual, un objetivo y una fecha de vencimiento.


## Pruebas recomendadas de la versión 5

1. En Presupuesto, crea una plantilla de gasto fijo mensual (por ejemplo, Luz) y selecciona una cuenta destino si procede.
2. Crea un fondo acumulativo con aportación mensual, objetivo y fecha de vencimiento.
3. Cambia al mes siguiente y verifica que ambas plantillas se han copiado.
4. Ajusta una partida del mes actual y vuelve al mes siguiente: el importe de la plantilla y del otro mes debe permanecer intacto.
5. Desactiva una plantilla y comprueba que deja de copiarse a meses nuevos; no elimina las partidas de meses ya preparados.

Nota: esta versión registra la aportación mensual y los datos objetivo del fondo. El seguimiento de saldo acumulado del fondo mediante movimientos reales y el cierre mensual completo se abordarán en una fase posterior.


## Versión 6 · Gastos reales y eliminación de plantillas

Después de actualizar los archivos, ejecuta `supabase-migration-006-real-expenses-template-deletion.sql` una sola vez, después de la migración 005. No vuelvas a ejecutar las migraciones anteriores ni el esquema inicial.

- En Presupuesto, los gastos fijos y variables muestran el importe real acumulado y la diferencia respecto al previsto.
- Puedes pulsar **Registrar gasto** en una partida o elegirla en el formulario de movimientos. El gasto se registra en una cuenta y queda vinculado a esa partida. La operación se realiza mediante una única función SQL: si falla, no se crea un movimiento parcial ni se actualiza solo una de las dos cifras. La fecha debe pertenecer al mes de la partida y el mes debe estar abierto.
- Los movimientos generales siguen pudiendo registrarse sin vincularlos a una partida.
- Las plantillas habituales de presupuesto ahora incluyen **Eliminar**. La aplicación pide confirmación. El borrado elimina la plantilla para el futuro, pero conserva las partidas mensuales ya copiadas y sus importes históricos.
- Los gastos vinculados quedan protegidos frente a edición o borrado directo para evitar que el saldo y el acumulado presupuestario queden desincronizados.

### Pruebas recomendadas

1. Crea una partida habitual de gasto fijo y comprueba que aparece en el mes seleccionado.
2. Desde Presupuesto, pulsa **Registrar gasto**, completa cuenta, concepto, fecha e importe y guarda. Comprueba que el saldo de la cuenta baja y que el importe real de la partida aumenta.
3. Registra un segundo gasto para la misma partida y verifica que el importe real se acumula.
4. Intenta vincular un gasto a una fecha de otro mes: debe mostrar un error y no crear el movimiento.
5. Elimina una plantilla habitual confirmando la acción. La plantilla debe desaparecer de la lista, pero la partida del mes actual y las de meses anteriores deben seguir visibles.
6. Comprueba que un mes cerrado no permite registrar gastos vinculados.

**Alcance de esta versión:** el seguimiento real ya está disponible para gastos fijos y variables. El saldo acumulado y los movimientos de aportación/pago de los fondos acumulativos, así como el cierre mensual completo, quedan para la siguiente iteración; no se deben interpretar todavía como saldos bancarios reales.

## Versión 7 · Asignación del dinero disponible

Esta versión añade en **Presupuesto** un bloque que calcula el dinero sin asignar como ingresos previstos del mes menos todas sus partidas presupuestadas. Permite asignar una parte o todo el remanente a cualquiera de las cuentas activas, incluida una cuenta de ahorro individual. Cada asignación se guarda como una partida mensual de tipo `additional_allocation`, vinculada a la cuenta elegida, y reduce el remanente disponible.

**Importante:** esta acción solo modifica el presupuesto. No crea movimientos, no transfiere dinero y no cambia el saldo de ninguna cuenta. La asignación se limita al dinero disponible calculado en el momento de guardar y no está disponible si el mes está cerrado, no hay cuentas activas o existe un exceso de asignación.

No requiere migración SQL. Actualiza los archivos de la aplicación conservando tu `supabase-config.js`.

### Pruebas recomendadas

1. Selecciona un mes con ingresos y partidas que dejen un remanente positivo.
2. En Presupuesto, asigna una parte del remanente a una cuenta individual y comprueba que baja el dinero sin asignar y aparece una nueva partida de asignación adicional.
3. Asigna el resto a otra cuenta y verifica que el remanente llega a cero.
4. Comprueba en Cuentas que los saldos no han cambiado y que no se ha creado ningún movimiento.
5. Intenta asignar más dinero del disponible: la aplicación debe impedirlo.
6. Consulta otro mes y comprueba que las asignaciones son independientes de ese mes.


## Versión 8 · Reparto proporcional del remanente entre ahorros personales

En el bloque **Dinero disponible sin asignar** se muestra cuánto corresponde al ahorro personal de cada miembro según su peso en los ingresos habituales del mes (nóminas). Se excluyen los ingresos extraordinarios del cálculo. Para cada persona se debe seleccionar una cuenta individual activa de su titularidad; si tiene varias, puede elegirse cuál recibe la asignación. Al confirmar, se crean partidas de tipo `individual_saving` en una única inserción, con el importe calculado al céntimo. No se crean transferencias ni movimientos bancarios y los saldos de las cuentas no cambian.

No requiere migración SQL: utiliza `member_id` de los ingresos mensuales y `owner_member_id` de las cuentas individuales existentes. La asignación se calcula sobre el remanente que siga sin asignar en ese mes, después de las demás partidas presupuestarias.
