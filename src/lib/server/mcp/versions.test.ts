import assert from 'node:assert/strict';
import test from 'node:test';
import { pageVersion, parsePageVersion } from './page-version.ts';

test('page versions are opaque and include generation plus revision', () => {
	const version = pageVersion(12, 'workspace-123');
	assert.deepEqual(parsePageVersion(version), { generation: 'workspace-123', revision: 12 });
	assert.equal(parsePageVersion('not-a-version'), null);
});
