# Aporia

Aporia is a SvelteKit application backed by SQLite.

## Developing

```sh
npm install
npm run dev
```

## Docker deployment

### Run the published image

Set the GHCR image path in `.env`:

```sh
cp .env.example .env
```

Then pull and start the image:

```sh
docker compose pull
docker compose up -d
```

Open <http://localhost:3001>. The host port is `3001`; the app listens on
container port `3000`. The SQLite database persists in the
`aporia-data` Docker volume.

```sh
docker compose logs -f aporia
docker compose down
```

### GitHub Actions and GHCR

`.github/workflows/docker-publish.yml` builds and publishes the Docker image
to GitHub Container Registry whenever `main` is updated. Push the workflow to
GitHub:

```sh
git add .
git commit -m "Add Docker deployment"
git push origin main
```

The workflow uses the automatic `GITHUB_TOKEN`; no repository secret is
required. It already requests `packages: write` permission.

### Deploy in the LXC

Copy the Aporia service from `docker-compose.yml` into the existing
`/opt/appsstack/docker-compose.yml` under its `services:` section. Do not add a
second top-level `services:` key.

```yaml
  aporia:
    image: ghcr.io/kinanqaz/aporia:latest
    container_name: aporia
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3000
      DATABASE_URL: /app/data/app.db
    volumes:
      - aporia-data:/app/data
```

Add this top-level section if it does not already exist:

```yaml
volumes:
  aporia-data:
```

The left side of `3001:3000` is the LXC host port. The right side must remain
`3000`, which is the port used inside the container. The app will be available
at `http://LXC_IP:3001`.

After editing `/opt/appsstack/docker-compose.yml`, validate and start it:

```sh
cd /opt/appsstack
docker compose config
docker compose pull aporia
docker compose up -d aporia
```

For a private GHCR package, authenticate first with a GitHub Personal Access
Token having `read:packages` permission:

```sh
docker login ghcr.io
```

After a new push to GitHub, update the LXC:

```sh
cd /opt/appsstack
docker compose pull aporia
docker compose up -d aporia
```
