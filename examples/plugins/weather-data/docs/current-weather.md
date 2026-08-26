# Current Weather

Reads current conditions through the host-mediated HTTP API. The guest cannot open a socket and can reach only `api.open-meteo.com` with `GET`. Rate-limit and redirect failures are returned as sandbox diagnostics.
