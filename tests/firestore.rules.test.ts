import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'demo-ybcrm';
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
let environment: RulesTestEnvironment;

before(async () => {
  if (!hasEmulator) return;
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

after(async () => {
  if (environment) await environment.cleanup();
});

beforeEach(async () => {
  if (environment) await environment.clearFirestore();
});

function employeeDb(uid = 'employee') {
  return environment.authenticatedContext(uid, {
    email: `${uid}@example.com`,
    email_verified: true,
  }).firestore();
}

function ownerDb() {
  return environment.authenticatedContext('owner', {
    email: 'ndtiger86@gmail.com',
    email_verified: true,
  }).firestore();
}

test('секретные настройки недоступны без входа и доступны владельцу', { skip: !hasEmulator }, async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'settings', 'ai_config'), { marker: true });
  });

  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'settings', 'ai_config')));
  await assertFails(getDoc(doc(employeeDb(), 'settings', 'ai_config')));
  await assertSucceeds(getDoc(doc(ownerDb(), 'settings', 'ai_config')));
});

test('сотрудник может читать настройки бота, но не менять их', { skip: !hasEmulator }, async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'settings', 'bot_config'), { welcomeText: 'test' });
  });

  await assertSucceeds(getDoc(doc(employeeDb(), 'settings', 'bot_config')));
  await assertFails(setDoc(doc(employeeDb(), 'settings', 'bot_config'), { welcomeText: 'changed' }));
  await assertSucceeds(setDoc(doc(ownerDb(), 'settings', 'bot_config'), { welcomeText: 'owner' }));
});

test('клиент не может подделать системные audit logs', { skip: !hasEmulator }, async () => {
  await assertFails(setDoc(doc(employeeDb(), 'audit_logs', 'fake'), { action: 'payment' }));
  await assertFails(setDoc(doc(ownerDb(), 'audit_logs', 'fake'), { action: 'payment' }));
  await assertFails(setDoc(doc(ownerDb(), 'ai_agent_audit_logs', 'fake'), { tool: 'get_orders' }));
  await assertFails(getDoc(doc(ownerDb(), 'ai_agent_audit_logs', 'fake')));
});

test('очередь AI и kill switch доступны только серверу', { skip: !hasEmulator }, async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'ai_jobs', 'job-1'), { status: 'queued' });
    await setDoc(doc(context.firestore(), 'ai_runtime_control', 'global'), { enabled: false });
  });

  for (const database of [employeeDb(), ownerDb()]) {
    await assertFails(getDoc(doc(database, 'ai_jobs', 'job-1')));
    await assertFails(setDoc(doc(database, 'ai_jobs', 'fake'), { status: 'succeeded' }));
    await assertFails(getDoc(doc(database, 'ai_runtime_control', 'global')));
    await assertFails(setDoc(doc(database, 'ai_runtime_control', 'global'), { enabled: true }));
    await assertFails(getDoc(doc(database, 'ai_incidents', 'incident-1')));
    await assertFails(setDoc(doc(database, 'ai_incidents', 'fake'), { status: 'new' }));
  }
});

test('операции с заказом запрещены без явно настроенного профиля', { skip: !hasEmulator }, async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'orders_new', 'order-1'), { paymentStatus: 'pending' });
  });

  await assertFails(updateDoc(doc(employeeDb('no-profile'), 'orders_new', 'order-1'), { paymentStatus: 'paid' }));
});

test('право payments работает только для активного настроенного профиля', { skip: !hasEmulator }, async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await setDoc(doc(database, 'orders_new', 'order-1'), { paymentStatus: 'pending' });
    await setDoc(doc(database, 'crm_access_profiles', 'cashier'), {
      active: true,
      orderActionsConfigured: true,
      allowedOrderActions: ['payments'],
    });
    await setDoc(doc(database, 'crm_access_profiles', 'inactive'), {
      active: false,
      orderActionsConfigured: true,
      allowedOrderActions: ['payments'],
    });
  });

  await assertSucceeds(updateDoc(doc(employeeDb('cashier'), 'orders_new', 'order-1'), { paymentStatus: 'paid' }));
  await assertFails(updateDoc(doc(employeeDb('inactive'), 'orders_new', 'order-1'), { paymentStatus: 'paid' }));
  const snapshot = await getDoc(doc(employeeDb('cashier'), 'orders_new', 'order-1'));
  assert.equal(snapshot.data()?.paymentStatus, 'paid');
});
