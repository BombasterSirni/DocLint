import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  twipsToMm,
  mmToTwips,
  halfPointsToPt,
  ptToHalfPoints,
  lineTwipsToMultiple,
  multipleToLineTwips,
  roundTo,
} from '../assets/js/units.js';

test('twips и миллиметры переводятся с точностью до 0,01 мм', () => {
  assert.equal(Math.round(twipsToMm(1440) * 100) / 100, 25.4);
  assert.equal(mmToTwips(25.4), 1440);
  assert.equal(mmToTwips(30), 1701);
  assert.equal(Math.round(twipsToMm(1701) * 100) / 100, 30);
});

test('половины пункта переводятся в пункты и обратно', () => {
  assert.equal(halfPointsToPt(28), 14);
  assert.equal(halfPointsToPt(21), 10.5);
  assert.equal(ptToHalfPoints(14), 28);
});

test('интервал в twips переводится в кратность', () => {
  assert.equal(lineTwipsToMultiple(240), 1);
  assert.equal(lineTwipsToMultiple(360), 1.5);
  assert.equal(multipleToLineTwips(1.5), 360);
  assert.equal(multipleToLineTwips(2), 480);
});

test('roundTo не оставляет хвостов и не теряет точность', () => {
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(12.5, 2), 12.5);
  assert.equal(roundTo(29.999999, 1), 30);
});
