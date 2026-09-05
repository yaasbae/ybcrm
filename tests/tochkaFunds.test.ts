import test from 'node:test';
import assert from 'node:assert/strict';
import { getTochkaFundName } from '../src/lib/tochkaFunds.ts';

test('recognizes every configured Tochka fund by account suffix', () => {
  const funds: Array<[string, string]> = [
    ['4080.158662 / 104', 'Возврат займа'],
    ['4080.158606 / 104', 'Собственник Анна'],
    ['4080.158615 / 104', 'Ткань и фурнитура'],
    ['4080.158654 / 104', 'Аутсорс'],
    ['4080.158607 / 104', 'Собственник Дмитрий'],
    ['4080.158630 / 104', 'СДЭК'],
    ['4080.158619 / 104', 'Процент менеджеру'],
    ['4080.135165 / 104', 'Налоги'],
    ['4080.064118 / 104', 'Подушка семьи'],
  ];

  for (const [accountId, name] of funds) assert.equal(getTochkaFundName(accountId), name);
});

test('does not classify the operating accounts as funds', () => {
  assert.equal(getTochkaFundName('4080.0613147 / 104'), null);
  assert.equal(getTochkaFundName('4080.0661822 / 104'), null);
});
