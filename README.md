# Cancha — gestor de implementos deportivos

Aplicación web local para que los encargados organicen el equipo, consulten cuántos implementos hay disponibles y registren quién usa cada uno y con qué motivo.

## Requisitos

- Node.js 20 o posterior.

## Incluye

- Inicio de sesión por cuenta con roles de administrador y personal.
- Resumen de implementos disponibles, prestados y por revisar.
- Administración de usuarios, implementos, categorías y códigos únicos opcionales. Solo administradores pueden gestionar cuentas, implementos y categorías; el personal puede consultar el inventario y registrar préstamos y devoluciones.
- Filtros por nombre, categoría y estado.
- Registro de préstamos con persona y motivo, y registro de devoluciones.
- Estados de disponible, en uso, mantenimiento y perdido; aviso de implementos perdidos.
- Almacenamiento local en `backend/data.json`.

Cada registro representa un implemento físico individual. Si hay cinco balones, registra cada balón por separado para poder saber cuál tiene cada persona.

La primera cuenta creada durante la configuración inicial tiene el rol de administrador. Las cuentas nuevas se crean desde la sección «Usuarios» y pueden tener rol de personal o administrador. Los registros de usuario antiguos sin rol se consideran administradores para conservar el acceso tras la actualización. Las contraseñas se guardan derivadas mediante scrypt. Las sesiones usan una cookie HTTP-only y se mantienen mientras el servidor está ejecutándose; al reiniciar el servidor hay que volver a iniciar sesión. Para usar la aplicación por HTTPS, configura `SECURE_COOKIES=true`.

## Estructura

- `backend/server.js`: servidor HTTP y API de Node.js, sin dependencias externas.
- `frontend/index.html`: estructura de las pantallas.
- `frontend/styles.css`: estilos adaptables a móvil y escritorio.
- `frontend/app.js`: interacción con la API y renderizado de la interfaz.