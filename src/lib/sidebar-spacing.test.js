import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('selecting a sidebar page does not change its icon-to-label spacing', () => {
	const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
	const activePageRules = [...css.matchAll(/\.page-item-row\.active\s*\{([^}]*)\}/g)].map(
		(match) => match[1]
	);

	assert.ok(activePageRules.length > 0, 'expected an active sidebar page rule');
	for (const declarations of activePageRules) {
		assert.doesNotMatch(
			declarations,
			/(?:^|;)\s*(?:gap|column-gap)\s*:/,
			'the selected state must not add space between the page icon and label'
		);
	}
});
