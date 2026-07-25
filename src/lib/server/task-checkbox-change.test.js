import assert from 'node:assert/strict';
import test from 'node:test';
import { isTaskCheckboxOnlyChange } from './task-checkbox-change.js';

/** @param {string} name @param {boolean} checked */
function task(name, checked) {
	return {
		type: 'taskItem',
		attrs: { checked },
		content: [{ type: 'paragraph', content: [{ type: 'text', text: name }] }]
	};
}

/** @param {any[]} content */
function documentWithTasks(content) {
	return {
		type: 'doc',
		content: [{ type: 'taskList', content }]
	};
}

test('locked checkbox changes may reorder task items', () => {
	const previous = documentWithTasks([task('A', false), task('B', false)]);
	const next = documentWithTasks([task('B', false), task('A', true)]);

	assert.equal(isTaskCheckboxOnlyChange(previous, next), true);
});

test('locked content edits are still rejected', () => {
	const previous = documentWithTasks([task('A', false), task('B', false)]);
	const next = documentWithTasks([task('B changed', false), task('A', true)]);

	assert.equal(isTaskCheckboxOnlyChange(previous, next), false);
});

test('ordinary task checkbox changes remain allowed without reordering', () => {
	const previous = documentWithTasks([task('A', false), task('B', false)]);
	const next = documentWithTasks([task('A', true), task('B', false)]);

	assert.equal(isTaskCheckboxOnlyChange(previous, next), true);
});
