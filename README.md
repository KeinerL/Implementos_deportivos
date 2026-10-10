# Sport Control — gestor de implementos deportivos

Aplicación web local para que los encargados organicen el equipo, consulten cuántos implementos hay disponibles y registren quién usa cada uno y con qué motivo.

## Requisitos

- Node.js 20 o posterior.

## Incluye

- Inicio de sesión por cuenta con roles de administrador y personal; cada persona puede cambiar la contraseña de su propia cuenta, confirmando la contraseña actual.
- Resumen de implementos disponibles, prestados y por revisar.
- Administración de usuarios, implementos, categorías y códigos únicos opcionales. Se pueden agregar hasta 100 unidades en una sola operación; si se indica un código base, cada unidad recibe un sufijo consecutivo. Los administradores pueden seleccionar y eliminar varios implementos a la vez, excepto los que estén prestados. Solo administradores pueden gestionar cuentas, implementos y categorías; el personal puede consultar el inventario y registrar préstamos y devoluciones.
- Filtros por nombre, categoría y estado.
- Registro de préstamos con persona, motivo, fecha y hora local, y registro de devoluciones. Se pueden seleccionar varios implementos disponibles y prestarlos juntos a la misma persona; el resumen agrupa los préstamos activos por persona y permite devolverlos todos en una sola acción.
- Estados de disponible, en uso, mantenimiento y perdido; aviso de implementos perdidos.

Cada registro representa un implemento físico individual. Si hay cinco balones, registra cada balón por separado para poder saber cuál tiene cada persona. Al agregar implementos se puede adjuntar una imagen PNG, JPG o WebP de hasta 2 MB; se muestra como miniatura en el inventario.

La primera cuenta creada durante la configuración inicial tiene el rol de administrador. Desde la pantalla de acceso cualquier persona puede crear una cuenta, que tendrá el rol de personal; las cuentas también se pueden crear desde la sección «Usuarios» con rol de personal o administrador. Un administrador puede modificar el nombre de cualquier cuenta, incluida la suya, sin cambiar su rol ni contraseña. Los registros de usuario antiguos sin rol se consideran administradores para conservar el acceso tras la actualización. Las contraseñas se guardan derivadas mediante scrypt. Las sesiones usan una cookie HTTP-only y se mantienen mientras el servidor está ejecutándose; al reiniciar el servidor hay que volver a iniciar sesión. Para usar la aplicación por HTTPS, configura `SECURE_COOKIES=true`.

## Estructura

- `backend/server.js`: servidor HTTP y API de Node.js, sin dependencias externas.
- `frontend/index.html`: estructura de las pantallas.
- `frontend/styles.css`: estilos adaptables a móvil y escritorio.
- `frontend/app.js`: interacción con la API y renderizado de la interfaz.
