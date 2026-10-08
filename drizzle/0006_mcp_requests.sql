CREATE TABLE IF NOT EXISTS mcp_requests (
	operation_id TEXT PRIMARY KEY NOT NULL,
	input_hash TEXT NOT NULL,
	page_id TEXT NOT NULL,
	created_at TEXT NOT NULL
);
