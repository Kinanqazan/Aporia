/**
 * Returns true only when two Tiptap documents differ by task-item checked
 * attributes and/or the resulting task-item order inside task lists.
 *
 * Locked pages use this guard to permit checkbox interactions without opening
 * the rest of the document to edits. Task lists are allowed to reorder because
 * the editor moves completed items to the bottom after a checkbox changes.
 *
 * @param {unknown} previous
 * @param {unknown} next
 */
export function isTaskCheckboxOnlyChange(previous, next) {
	let checkboxChanged = false;

	/**
	 * @param {unknown} left
	 * @param {unknown} right
	 * @param {{ ignoreChecked?: boolean, allowTaskItemReorder?: boolean }} [options]
	 * @returns {boolean}
	 */
	function compare(left, right, options = {}) {
		if (left === right) return true;

		if (Array.isArray(left) && Array.isArray(right)) {
			if (left.length !== right.length) return false;

			const canReorderTaskItems = options.allowTaskItemReorder &&
				left.every((item) => item && typeof item === 'object' && item.type === 'taskItem') &&
				right.every((item) => item && typeof item === 'object' && item.type === 'taskItem');

			if (canReorderTaskItems) {
				const matched = new Set();
				for (const leftItem of left) {
					let matchIndex = -1;
					for (let index = 0; index < right.length; index += 1) {
						if (matched.has(index)) continue;
						if (compare(leftItem, right[index], {
							...options,
							ignoreChecked: true
						})) {
							matchIndex = index;
							break;
						}
					}

					if (matchIndex < 0) return false;
					matched.add(matchIndex);
					if (!compare(leftItem, right[matchIndex], options)) return false;
				}
				return true;
			}

			return left.every((value, index) => compare(value, right[index], options));
		}

		if (left && right && typeof left === 'object' && typeof right === 'object') {
			const leftRecord = /** @type {Record<string, any>} */ (left);
			const rightRecord = /** @type {Record<string, any>} */ (right);
			const leftKeys = Object.keys(leftRecord);
			const rightKeys = Object.keys(rightRecord);
			if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !rightKeys.includes(key))) {
				return false;
			}

			return leftKeys.every((key) => {
				if (key === 'attrs' && leftRecord.type === 'taskItem' && rightRecord.type === 'taskItem') {
					const leftAttrs = leftRecord.attrs;
					const rightAttrs = rightRecord.attrs;
					if (!leftAttrs || !rightAttrs || typeof leftAttrs !== 'object' || typeof rightAttrs !== 'object') {
						return false;
					}

					const leftAttrKeys = Object.keys(leftAttrs);
					const rightAttrKeys = Object.keys(rightAttrs);
					if (leftAttrKeys.length !== rightAttrKeys.length || leftAttrKeys.some((attr) => !rightAttrKeys.includes(attr))) {
						return false;
					}

					return leftAttrKeys.every((attr) => {
						if (attr === 'checked') {
							if (!options.ignoreChecked && leftAttrs.checked !== rightAttrs.checked) checkboxChanged = true;
							return true;
						}
						return compare(leftAttrs[attr], rightAttrs[attr], options);
					});
				}

				const childOptions = key === 'content' && leftRecord.type === 'taskList' && rightRecord.type === 'taskList'
					? { ...options, allowTaskItemReorder: true }
					: options;
				return compare(leftRecord[key], rightRecord[key], childOptions);
			});
		}

		return false;
	}

	return compare(previous, next) && checkboxChanged;
}
