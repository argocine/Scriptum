import assert from 'node:assert/strict';
import {
  adjustRangesForReplacement,
  appendOffsetRanges,
  replaceTextWithRanges,
  splitOffsetRanges,
} from '../src/core/model.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok  ${name}`);
}

console.log('\nAnchored text ranges');

t('insertion before a range shifts it', () => {
  assert.deepEqual(
    adjustRangesForReplacement([{ start: 4, end: 8, itemId: 'prop' }], 2, 2, 3),
    [{ start: 7, end: 11, itemId: 'prop' }]
  );
});

t('insertion inside a range expands it', () => {
  assert.deepEqual(
    adjustRangesForReplacement([{ start: 2, end: 8, itemId: 'prop' }], 5, 5, 2),
    [{ start: 2, end: 10, itemId: 'prop' }]
  );
});

t('insertion at either boundary stays outside the range', () => {
  assert.deepEqual(
    adjustRangesForReplacement([{ start: 2, end: 8 }], 2, 2, 2),
    [{ start: 4, end: 10 }]
  );
  assert.deepEqual(
    adjustRangesForReplacement([{ start: 2, end: 8 }], 8, 8, 2),
    [{ start: 2, end: 8 }]
  );
});

t('replacement preserves annotations that overlap the replacement', () => {
  assert.deepEqual(
    adjustRangesForReplacement([{ start: 2, end: 8, category: 'cast' }], 4, 6, 5),
    [{ start: 2, end: 11, category: 'cast' }]
  );
  assert.deepEqual(
    adjustRangesForReplacement([{ start: 4, end: 6, category: 'cast' }], 4, 6, 1),
    [{ start: 4, end: 5, category: 'cast' }]
  );
});

t('deleting an entire range removes the empty annotation', () => {
  assert.deepEqual(adjustRangesForReplacement([{ start: 4, end: 6 }], 3, 7, 0), []);
});

t('ranges split and rebase without losing metadata', () => {
  const [left, right] = splitOffsetRanges(
    [{ start: 2, end: 8, itemId: 'wardrobe' }],
    5
  );
  assert.deepEqual(left, [{ start: 2, end: 5, itemId: 'wardrobe' }]);
  assert.deepEqual(right, [{ start: 0, end: 3, itemId: 'wardrobe' }]);
});

t('appending ranges shifts only the appended side', () => {
  assert.deepEqual(
    appendOffsetRanges(
      [{ start: 0, end: 2, itemId: 'a' }],
      [{ start: 1, end: 3, itemId: 'b' }],
      5
    ),
    [
      { start: 0, end: 2, itemId: 'a' },
      { start: 6, end: 8, itemId: 'b' },
    ]
  );
});

t('text replacement clamps offsets and returns a new value', () => {
  const ranges = [{ start: 1, end: 4, itemId: 'prop' }];
  const result = replaceTextWithRanges('abcde', ranges, -10, 2, 'Z');
  assert.equal(result.text, 'Zcde');
  assert.deepEqual(result.ranges, [{ start: 0, end: 3, itemId: 'prop' }]);
  assert.deepEqual(ranges, [{ start: 1, end: 4, itemId: 'prop' }], 'input was mutated');
});

t('invalid and zero-length ranges are discarded safely', () => {
  assert.deepEqual(
    adjustRangesForReplacement([null, { start: 2, end: 2 }, { start: 'x', end: 4 }], 0, 0, 1),
    []
  );
});

t('invalid and fractional edit coordinates are safely normalized', () => {
  const ranges = [{ start: 1, end: 3, itemId: 'prop' }];
  assert.deepEqual(
    replaceTextWithRanges('abcd', ranges, Number.NaN, Number.NaN, 'Z'),
    { text: 'Zabcd', ranges: [{ start: 2, end: 4, itemId: 'prop' }] }
  );
  assert.deepEqual(
    replaceTextWithRanges('abcd', ranges, 1.9, 3.8, 'X'),
    { text: 'aXd', ranges: [{ start: 1, end: 2, itemId: 'prop' }] }
  );
});

console.log(`\n${pass} range checks passed.`);
