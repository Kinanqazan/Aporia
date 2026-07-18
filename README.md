# Aporia deployment

## 1. Publish the image

Push the repository to GitHub. The workflow in
`.github/workflows/docker-publish.yml` builds and publishes the image to GHCR:

```text
ghcr.io/<github-owner>/<repository>:latest
```

Wait for the GitHub Actions workflow to finish successfully.

## 2. Prepare the Docker host

On the Docker host or LXC, create a directory for the SQLite database:

```sh
mkdir -p /opt/appsstack/config/aporia
chown -R 1000:1000 /opt/appsstack/config/aporia
```

The directory can be changed, but it must match the Compose bind mount.

## 3. Add the service to Compose

Add this service under the existing top-level `services:` section in your
Compose file:

```yaml
  aporia:
    image: ghcr.io/<github-owner>/<repository>:latest
    container_name: aporia
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3000"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_URL: /app/data/app.db
    volumes:
      - ./config/aporia:/app/data
```

Replace `<github-owner>/<repository>` with the actual GHCR image path.

Port `3000` is the container port. Port `3001` is the host port used by the
reverse proxy. If the app should be directly accessible without a reverse
proxy, change the mapping to:

```yaml
      - "3001:3000"
```

## 4. Authenticate to GHCR

For a private image, log in on the Docker host with a GitHub token that has
`read:packages` permission:

```sh
docker login ghcr.io
```

Public images do not normally require login.

## 5. Start the service

Run these commands from the directory containing the Compose file:

```sh
docker compose config
docker compose pull aporia
docker compose up -d aporia
```

Check the service:

```sh
docker compose ps aporia
docker compose logs -f aporia
```

## 6. Optional: use Caddy

For an HTTPS hostname, add a site to the Caddyfile:

```caddy
aporia.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Point the hostname to the Docker host and reload Caddy:

```sh
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Open the app at `https://aporia.example.com`. No `.env` file or `ORIGIN`
setting is required when Caddy provides HTTPS.

## 7. Update the app

After a new image has been published:

```sh
docker compose pull aporia
docker compose up -d aporia
```

The SQLite database remains in the bind-mounted host directory.
