#!/usr/bin/env node
// Print an AUTH_PASSWORD_HASH value:  node server/src/auth/hash.js            (prompts, input hidden)
//                                     echo -n 'secret' | node server/src/auth/hash.js
import readline from 'node:readline';
import { hashPassword } from './password.js';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => {
    if (s.includes('Password')) process.stdout.write(s);
  };
  const pw = await new Promise((resolve) => rl.question('Password: ', resolve));
  rl.close();
  process.stdout.write('\n');
  return pw;
}

const pw = await readPassword();
if (!pw) {
  console.error('empty password');
  process.exit(1);
}
console.log(`AUTH_PASSWORD_HASH=${await hashPassword(pw)}`);
