import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	parseExpandedSidebarPageIds,
	parseExpandedSidebarState,
	serializeExpandedSidebarState,
	shouldReplaceExpandedSidebarState
} from './sidebar-state.js';

const layout = readFileSync(new URL('../routes/+layout.svelte', import.meta.url), 'utf8');
const layoutServer = readFileSync(new URL('../routes/+layout.server.ts', import.meta.url), 'utf8');
const appTemplate = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

test('the saved theme controls the document and toggle before hydration', () => {
	assert.ok(
		appTemplate.indexOf("localStorage.getItem('theme')") < appTemplate.indexOf('%sveltekit.head%'),
		'the theme class must be selected before the app can paint'
	);
	assert.match(layout, /class="theme-icon theme-icon-light-mode"[\s\S]*?<Moon/);
	assert.match(layout, /class="theme-icon theme-icon-dark-mode"[\s\S]*?<Sun/);
	assert.match(layout, /:global\(html\.dark\) \.theme-icon-dark-mode/);
});

test('expanded sidebar pages are part of the server-rendered startup state', () => {
	assert.match(layoutServer, /get\('aporia-expanded-sidebar-pages'\)/);
	assert.match(layoutServer, /expandedSidebarPageIds/);
	assert.match(layout, /return new Set<string>\(data\.expandedSidebarPageIds \?\? \[\]\)/);
	assert.match(layout, /encodedCookieState\.length <= 3800/);
	assert.match(layout, /key: expandedNodesStorageKey, value: serializedNodes/);
});

test('expanded sidebar persistence rejects malformed, duplicate, and stale IDs', () => {
	const validIds = new Set(['parent', 'child']);
	assert.deepEqual(
		parseExpandedSidebarPageIds('["parent","parent","deleted",4]', validIds),
		['parent']
	);
	assert.deepEqual(parseExpandedSidebarPageIds('{broken', validIds), []);
	assert.equal(
		serializeExpandedSidebarState(['parent', 'parent', 'child'], 42),
		'{"ids":["parent","child"],"updatedAt":42}'
	);
});

test('newer local sidebar state survives an interrupted server save', () => {
	const serverState = parseExpandedSidebarState('{"ids":["old"],"updatedAt":10}');
	const localState = parseExpandedSidebarState('{"ids":["new"],"updatedAt":11}');
	assert.ok(localState.updatedAt > serverState.updatedAt);
	assert.deepEqual(localState.ids, ['new']);
	assert.equal(
		shouldReplaceExpandedSidebarState(
			'{"ids":["new"],"updatedAt":11}',
			'{"ids":["old"],"updatedAt":10}'
		),
		false
	);
});
