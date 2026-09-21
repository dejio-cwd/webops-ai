import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress } from '../api/audit.js';

test('blocks private IPv4 ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.169.254']) assert.equal(isPrivateAddress(ip), true, ip);
});

test('allows public IPv4 addresses', () => {
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('blocks local IPv6 addresses', () => {
  for (const ip of ['::1', 'fe80::1', 'fd00::1']) assert.equal(isPrivateAddress(ip), true, ip);
});
