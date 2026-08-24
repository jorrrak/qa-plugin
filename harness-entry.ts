import { generate, exportBlob } from './lib/codegen';
import { toZephyrXlsx } from './lib/export/zephyr';
import type { Session, TargetInfo } from './lib/types';
import { writeFileSync } from 'node:fs';

const t = (o: Partial<TargetInfo>): TargetInfo => ({ xpath: '//x', xpathAbsolute: '/x',
  cssSelector: 'x', textName: 'X', tagName: 'div', elementKind: 'other', unique: true, ...o });

const login: Session = {
  id: 's', tabId: 1, title: 'ورود با شماره تماس — Login with phone',
  startedAt: 1756000000000, recording: false, nextSeq: 9,
  steps: [
    { id: '1', seq: 1, action: 'navigate', value: 'https://app.test/login', url: 'https://app.test/login', timestamp: 0 },
    { id: '2', seq: 2, action: 'fill', variable: 'TEST_PHONE', url: 'u', timestamp: 0,
      target: t({ textName: 'Phone number', tagName: 'input', elementKind: 'input' }) },
    { id: '3', seq: 3, action: 'fill', variable: 'TEST_PASSWORD', url: 'u', timestamp: 0,
      target: t({ textName: 'Password', tagName: 'input', elementKind: 'input' }) },
    { id: '4', seq: 4, action: 'click', url: 'u', timestamp: 0,
      target: t({ textName: 'Log in', tagName: 'button', elementKind: 'button' }) },
    // Two assertions in a row: both must land on step 4's expected result.
    { id: '5', seq: 5, action: 'assertUrl', value: 'https://app.test/home', url: 'u', timestamp: 0 },
    { id: '6', seq: 6, action: 'assertText', value: 'Dashboard', url: 'u', timestamp: 0,
      target: t({ textName: 'Heading', tagName: 'h1' }) },
    { id: '7', seq: 7, action: 'check', url: 'u', timestamp: 0,
      target: t({ textName: 'Remember me', tagName: 'input', elementKind: 'checkbox' }) },
    { id: '8', seq: 8, action: 'assertHidden', url: 'u', timestamp: 0,
      target: t({ textName: 'Spinner' }) },
  ],
  issues: [
    { id: 'i1', kind: 'http-error', severity: 'error', message: '500 on /api/session', url: 'u', timestamp: 0, nearStepId: '4', count: 2 },
  ],
};

// A recording that opens with an assertion — nothing to attach it to.
const leading: Session = {
  id: 's2', tabId: 1, title: 'Leading assertion', startedAt: 1756000000000, recording: false, nextSeq: 3, issues: [],
  steps: [
    { id: 'a', seq: 1, action: 'assertVisible', url: 'u', timestamp: 0, target: t({ textName: 'Banner' }) },
    { id: 'b', seq: 2, action: 'click', url: 'u', timestamp: 0, target: t({ textName: 'Close', tagName: 'button', elementKind: 'button' }) },
  ],
};

const csv = generate([login, leading], 'zephyr-csv', { locatorStrategy: 'smart', testName: 'x' });
writeFileSync(process.argv[2] + '/zephyr.csv', csv);
writeFileSync(process.argv[2] + '/zephyr.xlsx', toZephyrXlsx([login, leading]));
console.log(csv);
