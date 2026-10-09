# Cancha — gestor de implementos deportivos

Aplicación web local para que los encargados organicen el equipo, consulten cuántos implementos hay disponibles y registren quién usa cada uno y con qué motivo.

## Requisitos

- Node.js 20 o posterior.

## Incluye

- Inicio de sesión para encargados y cierre de sesión.
- Resumen de implementos disponibles, prestados y por revisar.
- Administración de implementos, categorías y códigos únicos opcionales.
- Filtros por nombre, categoría y estado.
- Registro de préstamos con persona y motivo, y registro de devoluciones.
- Estados de disponible, en uso, mantenimiento y perdido; aviso de implementos perdidos.
- Almacenamiento local en `backend/data.json`.

Cada registro representa un implemento físico individual. Si hay cinco balones, registra cada balón por separado para poder saber cuál tiene cada persona.

La cuenta inicial se guarda con contraseña derivada mediante scrypt. Las sesiones usan una cookie HTTP-only y se mantienen mientras el servidor está ejecutándose; al reiniciar el servidor hay que volver a iniciar sesión. Para usar la aplicación por HTTPS, configura `SECURE_COOKIES=true`.

## Estructura

- `backend/server.js`: servidor HTTP y API de Node.js, sin dependencias externas.
- `frontend/index.html`: estructura de las pantallas.
- `frontend/styles.css`: estilos adaptables a móvil y escritorio.
- `frontend/app.js`: interacción con la API y renderizado de la interfaz.