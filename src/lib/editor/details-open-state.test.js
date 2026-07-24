import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeDetailsElement } from './details-open-state.js';

/** @param {boolean} open */
function fixture(open) {
	const classes = new Set();
	const content = {
		hidden: true,
		/** @param {string} name @param {boolean} force */
		toggleAttribute(name, force) {
			if (name === 'hidden') this.hidden = force;
		}
	};
	const dom = {
		classList: {
			/** @param {string} name @param {boolean} [force] */
			toggle(name, force) {
				if (force === undefined) {
					if (classes.has(name)) classes.delete(name);
					else classes.add(name);
				} else if (force) classes.add(name);
				else classes.delete(name);
			}
		},
		querySelector() {
			return content;
		}
	};
	return { dom, classes, content };
}

test('an open details node cannot retain hidden nested content', () => {
	const { dom, classes, content } = fixture(true);
	synchronizeDetailsElement(dom, true);
	assert.equal(classes.has('is-open'), true);
	assert.equal(content.hidden, false);
});

test('a closed details node keeps its nested content hidden', () => {
	const { dom, classes, content } = fixture(false);
	synchronizeDetailsElement(dom, false);
	assert.equal(classes.has('is-open'), false);
	assert.equal(content.hidden, true);
});

test('the delayed Details initializer cannot close an Arabic-decorated open toggle', async () => {
	const { dom, classes } = fixture(true);

	// Tiptap schedules a non-idempotent toggle during node-view creation.
	setTimeout(() => dom.classList.toggle('is-open'), 0);
	// Arabic decorations update the node view before that timer runs.
	dom.classList.toggle('is-open', true);
	setTimeout(() => synchronizeDetailsElement(dom, true), 0);

	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(classes.has('is-open'), true);
});
