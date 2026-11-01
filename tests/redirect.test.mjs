import test from 'node:test';
import assert from 'node:assert/strict';
import {destination} from '../scripts/build-pages-redirect.mjs';

test('previous GitHub Pages URLs preserve their destination, query and hash on the fixed Workers origin',()=>{
  assert.equal(destination('https://cosmicjh.github.io/timetable/'),'https://school-timetable.cosmicjh.workers.dev/');
  assert.equal(destination('https://cosmicjh.github.io/timetable/admin.html?from=bookmark#/settings'),'https://school-timetable.cosmicjh.workers.dev/admin.html?from=bookmark#/settings');
  assert.equal(destination('https://cosmicjh.github.io/timetable/student.html'),'https://school-timetable.cosmicjh.workers.dev/student.html');
  assert.equal(destination('https://cosmicjh.github.io/timetable/teacher'),'https://school-timetable.cosmicjh.workers.dev/teacher.html');
  assert.equal(new URL(destination('https://cosmicjh.github.io/timetable/unknown?redirect=https://example.com')).origin,'https://school-timetable.cosmicjh.workers.dev');
});
