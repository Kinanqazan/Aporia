# Connect an assistant to Aporia

Aporia exposes its saved pages through one authenticated MCP endpoint at `/mcp`. The endpoint runs inside the normal Aporia container and uses its existing database. Your assistant gets a separate bearer key; it does not get your browser password or session cookie.

The server exposes eleven tools. Existing-page changes require `expectedVersion` from a read, list, or previous write. If another client changes the page first, Aporia reports a conflict and keeps the stale change from overwriting it. Trash includes descendants; permanent deletion remains in the browser. Page content is stored as TipTap JSON, so an assistant should preserve nodes and formatting it did not intend to change.

| Tool | What it does |
| --- | --- |
| `list_pages` | List active or trashed pages, optionally by parent, with pagination and current versions |
| `search_pages` | Search active page titles and text |
| `read_page` | Read complete TipTap content, Markdown, metadata, and lock/layout state |
| `create_page` | Create a page with optional content, parent, icon, icon color, full-width layout, and lock |
| `update_page` | Change title, icon, icon color, layout, and/or replace the document; omitted fields stay unchanged |
| `append_page_content` | Add top-level TipTap blocks while preserving existing content and formatting |
| `set_page_lock` | Lock or unlock a page explicitly |
| `set_page_layout` | Set full-width or normal-width layout |
| `move_page` | Move or reorder a page |
| `trash_page` | Move a page and its descendants to Trash |
| `restore_page` | Restore a page and its trashed descendants |

For an authorized edit to a locked page, Hermes should read it, call `set_page_lock` with `isLocked: false`, edit using the returned version, then call `set_page_lock` with `isLocked: true` and the edit's returned version. Locks are never silently bypassed by content, metadata, layout, move, or Trash tools. A lock change only affects that page. Trashed pages must be restored before changing their lock or content. Setting the same lock or layout leaves the version unchanged.

`append_page_content` takes a nonempty `blocks` array, for example:

```json
{
  "id": "page-id",
  "expectedVersion": "version-from-last-read-or-write",
  "blocks": [{ "type": "paragraph", "content": [{ "type": "text", "text": "New note" }] }]
}
```

The server validates the combined document and its asset references before saving. Retrying with the old version reports a conflict instead of appending twice. After an uncertain response, read the page and check whether the addition committed before trying again.

Icons accept emoji or names such as `lucide:book-open`; `null` resets the icon to its default appearance. `iconColor` accepts `null` for default or one of `#e86666`, `#f97316`, `#eab308`, `#22c55e`, `#3b82f6`, `#8b5cf6`, `#ec4899`, `#64748b`. Content updates can edit all supported editor blocks, including tasks and database blocks. Uploading new files, importing workspaces, backups, browser preferences, and permanent deletion remain browser operations.

After deploying an updated Aporia build, reload Hermes' MCP connection or start a fresh Hermes session so it discovers the new tools and input fields. The endpoint URL and bearer key stay the same.

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
