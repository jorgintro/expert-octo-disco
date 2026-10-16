# Changelog

Formato de versión 0.X.y. La 1.0.0 solo se publica el día de las elecciones.

## 0.1.1 — Fase 0.1: esqueleto

- Servidor Fastify con `/healthz` y `/version`.
- Página de inicio mobile-first (360 px) con la versión en el pie.
- Cabeceras de seguridad básicas.
- `Dockerfile` y `docker-compose.yml` (red externa `npm_default`, puerto interno 3000).
- Guía de despliegue detrás de Nginx Proxy Manager en el `README.md`.
- Pruebas automáticas de los endpoints.
