import assert from 'node:assert/strict';
import { constrainImageSizeToWidth } from '../src/lib/editor/image-resize.ts';

const original = { width: 1200, height: 800 };
const constrained = constrainImageSizeToWidth(original, 720);

assert.equal(constrained.width, 720, 'an enlarged image must fit its containing block');
assert.equal(constrained.height, 480, 'height must be reduced with width to preserve aspect ratio');
assert.equal(constrained.width / constrained.height, original.width / original.height);

console.log('image resize aspect-ratio check passed');
