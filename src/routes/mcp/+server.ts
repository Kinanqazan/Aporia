import type { RequestHandler } from './$types';
import { handleMcpRequest } from '$lib/server/mcp/server';

const handle: RequestHandler = ({ request }) => handleMcpRequest(request);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
