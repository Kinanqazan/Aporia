import assert from 'node:assert/strict';
import test from 'node:test';
import { sortTaskItemsByCompletionAndOrder } from './extensions/TaskListExtension.ts';

function task(id: string, checked: boolean, order: number) {
	return { id, attrs: { checked, order } };
}

test('unchecking a completed task restores its manual order among active tasks', () => {
	const before = [task('B', false, 1), task('A', true, 0)];
	const afterUnchecking = before.map((item) =>
		item.id === 'A' ? { ...item, attrs: { ...item.attrs, checked: false } } : item
	);

	assert.deepEqual(
		sortTaskItemsByCompletionAndOrder(afterUnchecking).map((item) => item.id),
		['A', 'B']
	);
});

test('a drag-updated manual order remains stable within each completion group', () => {
	const tasks = [task('B', false, 0), task('A', false, 1), task('C', true, 2)];

	assert.deepEqual(
		sortTaskItemsByCompletionAndOrder(tasks).map((item) => item.id),
		['B', 'A', 'C']
	);
});
