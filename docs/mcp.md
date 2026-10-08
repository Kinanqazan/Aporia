# Connect an assistant to Aporia

Aporia exposes its saved pages through one authenticated MCP endpoint at `/mcp`. The endpoint runs inside the normal Aporia container and uses its existing database. Your assistant gets a separate bearer key; it does not get your browser password or session cookie.

The server exposes `list_pages`, `search_pages`, `read_page`, `create_page`, `update_page`, `move_page`, `trash_page`, and `restore_page`. Existing-page edits require the version returned by a read. If another client changes the page first, Aporia reports a conflict and keeps the stale edit from overwriting it. Trash includes descendants; permanent deletion remains in the browser. Page content is stored as TipTap JSON, so an assistant should preserve nodes and formatting it did not intend to change.

## Enable the endpoint

Set these values in the environment file used by your Aporia Compose project:

```dotenv
APORIA_MCP_ENABLED=true
APORIA_MCP_TOKEN=replace-with-a-long-random-secret
APORIA_MCP_ALLOWED_ORIGINS=http://aporia:3000,https://notes.example.com
```

Generate a key on the Docker host with `openssl rand -hex 32`. Keep it in the server's private environment file, not in Git, a shared Compose file, or a conversation. Use the exact origins clients will use, with no path or trailing slash: one for Hermes' Docker address and one for the desktop-facing address. If you do not use HTTPS, the desktop origin can be `http://192.168.1.50:3001`. Replace these examples with your real host and port. The Aporia password setup must already be complete. Public demo mode always disables MCP.

Restart Aporia after changing the environment. Set `APORIA_MCP_ENABLED=false` to turn the endpoint off. Rotate the key by replacing it and restarting Aporia, then updating both clients. The endpoint returns 404 while disabled and rejects requests with an unlisted Host or browser Origin. It does not enable CORS or trust forwarded headers.

## Let the Hermes container reach Aporia

If the two containers are in the same Compose project and default network, Hermes can usually use `http://aporia:3000/mcp`. If they are in separate projects, attach both services to one existing or external Docker network. For example, create a private network once with `docker network create aporia-mcp`, then add this to the Aporia Compose service:

```yaml
services:
  aporia:
    networks: [aporia-mcp]

networks:
  aporia-mcp:
    external: true
```

Add the same `networks: [aporia-mcp]` and external network declaration to the Hermes service's Compose file. This is only container-to-container reachability; it does not publish Aporia's container port to the internet. `localhost` inside Hermes means the Hermes container itself.

Store the same token in Hermes' private environment or `~/.hermes/.env`, then add this under `mcp_servers` in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  aporia:
    url: http://aporia:3000/mcp
    headers:
      Authorization: "Bearer ${APORIA_MCP_TOKEN}"
```

Restart Hermes and run `hermes mcp test aporia` to check the connection and tool list. If this Hermes version does not expand the environment variable, put the key directly in the private Hermes config file and restrict that file's permissions.

## Connect desktop Codex

Codex runs on your desktop, so use the Aporia address reachable from the desktop, such as your existing HTTPS address or `http://192.168.1.50:3001/mcp`. The Docker service name `aporia` is normally only visible to containers on that Docker network.

Put the key in `~/.codex/.env` (on Windows, `%USERPROFILE%\.codex\.env`):

```dotenv
APORIA_MCP_TOKEN=your-same-random-secret
```

Add this server to `~/.codex/config.toml` (on Windows, `%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.aporia]
url = "https://notes.example.com/mcp"
bearer_token_env_var = "APORIA_MCP_TOKEN"
```

Use the exact address you added to `APORIA_MCP_ALLOWED_ORIGINS`. Restart Codex after changing its configuration. If Codex reports that it cannot reach the server, first check desktop-to-Aporia network access and the host port; Hermes' Docker address will not work from the desktop.

## Recovery

Take Aporia's normal workspace backup before broad edits. Restoring a backup clears create-retry receipts and changes the workspace generation, so older page versions cannot be used to overwrite restored pages. Create receipts expire after 30 days; after that, check the page list before retrying an uncertain create.

### References

- [Hermes MCP configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)
- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/)
