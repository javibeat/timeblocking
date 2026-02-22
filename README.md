# Timeblocking (ICS) — Javi Beat

Genera un calendario **suscrito** (`.ics`) para Apple Calendar con **bloques de trabajo por la mañana**, evitando automáticamente tus **gigs + 1h antes + 1h después**.

Este calendario es **solo visual** (sin avisos) y está pensado para *timeblocking* sin duplicados (porque es una suscripción, no una importación diaria).

## Qué incluye (y qué NO)

### Incluye (en el calendario suscrito)
Bloques de trabajo **solo por la mañana** (L–V):
- `Música (escuchar/descargar)` — 30 min (prioridad 1)
- `Nibango (deep work)` — 90 min (prioridad 2)
- `YouTube (vídeo viernes)` — 60 min (prioridad 3)

Reglas:
- No se programan bloques durante: **gig + 1h antes + 1h después**
- No se programan bloques durante el desayuno (**08:00–08:30**)
- No se ponen bloques por la tarde (de momento)
- Se generan para **los próximos 7 días**
- Si no cabe todo, se cae lo de menor prioridad (YouTube primero)

### NO incluye
- No incluye tus gigs (ya los tienes en tu calendario principal)
- No crea eventos “Move/Buffer”: solo evita esos horarios al programar bloques

## Fuente de datos (gigs)
Endpoint JSON (Django/Railway):

`GET https://sunsetdjsnew-production.up.railway.app/api/gigs/?dj=javi`

Devuelve algo como:
```json
{
  "server_date": "2026-02-22",
  "gigs": [
    { "venue": "Aura", "date": "2026-02-22", "time": "02:45 PM - 06:45 PM", "is_event": false, "comment": "" }
  ]
}
