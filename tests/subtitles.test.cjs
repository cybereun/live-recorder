const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSrt, srtTimeToMs } = require('../subtitles.cjs');
test('parseSrt reads timings and joins wrapped text', () => {
  const srt = '\uFEFF1\r\n00:00:01,500 --> 00:00:04,000\r\n안녕하세요\r\n여러분\r\n\r\n2\r\n01:02:03,004 --> 01:02:05,000\r\n두 번째\r\n\r\n3\r\nbroken\r\n';
  assert.deepEqual(parseSrt(srt), [
    { startMs: 1500, endMs: 4000, text: '안녕하세요 여러분' },
    { startMs: 3723004, endMs: 3725000, text: '두 번째' },
  ]);
  assert.equal(srtTimeToMs('00:00:01.5'), 1500);
  assert.equal(srtTimeToMs('nope'), null);
  assert.deepEqual(parseSrt(''), []);
});
