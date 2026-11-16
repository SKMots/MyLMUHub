# My LMU Hub team server

Optional. A small server for a team that uses My LMU Hub: teams, invite codes, roles and the team's race results (team race pace and live race sharing
come later). You only need it if you host it for your team; the app works without it.

## How it keeps your server safe
- **No open ports.** It runs behind a Cloudflare tunnel, which connects out to Cloudflare.
- **Shut away.** The server's network is internal: it cannot reach the internet or the rest of your home network.
- **Locked down.** A minimal image (no shell), not root, a read-only container; only the database folder is written.
- **Invite only.** Nobody can send anything without an invite code from a team owner. Codes work once, expire, and only their hash is stored; each member has their own key, which the owner can take away.
- **Roles checked on the server:** owner, engineer, driver.
- **Only checked numbers and short text are accepted.** JSON only, at most 64 KB, only known fields, every value checked. Nothing a member sends is run, opened or saved as a file.
- **Rate limits** per member and per address.

## Run it
See the steps at the top of `docker-compose.yml`. The first start prints a one-time setup key in the log (`docker compose logs mlh-server`); enter it in
My LMU Hub to become the server owner. Keep `data/` backed up: it holds the database.

When someone leaves a team, their personal data for that team is deleted; the team's race results they were part of stay.
