import { timingSafeEqual } from 'node:crypto';

export interface McpAuthConfig {
	enabled: boolean;
	demoMode: boolean;
	privateWorkspaceReady: boolean;
	token?: string;
	allowedOrigins: string;
}

export function authorizeMcpRequest(request: Request, config: McpAuthConfig): Response | null {
	if (!config.enabled || config.demoMode) return new Response('Not found', { status: 404 });
	if (!config.privateWorkspaceReady) return new Response('MCP requires a configured private workspace', { status: 503 });
	let origins: Set<string>;
	let allowedHosts: Set<string>;
	try {
		const parsed = config.allowedOrigins.split(',').map((item) => item.trim()).filter(Boolean).map((value) => {
			const origin = new URL(value);
			if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value.replace(/\/$/, '')) throw new Error('invalid origin');
			return origin;
		});
		origins = new Set(parsed.map((origin) => origin.origin));
		allowedHosts = new Set(parsed.map((origin) => origin.host.toLowerCase()));
	} catch {
		return new Response('MCP origin configuration is invalid', { status: 503 });
	}
	if (!config.token || config.token.length < 32 || origins.size === 0) return new Response('MCP is not configured', { status: 503 });
	const host = (request.headers.get('host') ?? new URL(request.url).host).toLowerCase();
	const requestOrigin = request.headers.get('origin');
	if (!allowedHosts.has(host) || (requestOrigin !== null && !origins.has(requestOrigin))) {
		return new Response('Origin not allowed', { status: 403 });
	}
	const provided = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	const expectedBytes = Buffer.from(config.token);
	const providedBytes = Buffer.from(provided);
	const matches = expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
	if (!matches) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
	return null;
}
