import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeMcpRequest } from './auth.ts';

const token = 'a'.repeat(64);
const config = { enabled: true, demoMode: false, privateWorkspaceReady: true, token, allowedOrigins: 'http://aporia:3000,https://notes.example.test' };
const request = (headers: Record<string, string> = {}) => new Request('http://aporia:3000/mcp', { headers: { host: 'aporia:3000', ...headers } });

test('MCP authentication fails closed while disabled, in demo mode, or misconfigured', () => {
	assert.equal(authorizeMcpRequest(request(), { ...config, enabled: false })?.status, 404);
	assert.equal(authorizeMcpRequest(request(), { ...config, demoMode: true })?.status, 404);
	assert.equal(authorizeMcpRequest(request(), { ...config, token: '' })?.status, 503);
	assert.equal(authorizeMcpRequest(request(), { ...config, allowedOrigins: '*' })?.status, 503);
});

test('MCP requires a bearer key and validates Host and any supplied Origin', () => {
	assert.equal(authorizeMcpRequest(request(), config)?.status, 401);
	assert.equal(authorizeMcpRequest(request({ authorization: `Bearer ${'b'.repeat(64)}` }), config)?.status, 401);
	assert.equal(authorizeMcpRequest(request({ host: 'attacker.test', authorization: `Bearer ${token}` }), config)?.status, 403);
	assert.equal(authorizeMcpRequest(request({ origin: 'https://attacker.test', authorization: `Bearer ${token}` }), config)?.status, 403);
	assert.equal(authorizeMcpRequest(request({ origin: 'http://aporia:3000', authorization: `Bearer ${token}` }), config), null);
});

test('an incomplete private workspace cannot be accessed through MCP', () => {
	assert.equal(authorizeMcpRequest(request({ authorization: `Bearer ${token}` }), { ...config, privateWorkspaceReady: false })?.status, 503);
});
