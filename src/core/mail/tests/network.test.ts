import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { deliver } from '../send';
// A listener that greets like an SMTP server but offers no STARTTLS: the real client must refuse
// to send rather than fall back to clear text.
let plain: Server;
let port = 0;
const received: string[] = [];
beforeAll(async () => {
  plain = createServer((socket) => {
    socket.write('220 plain.example.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      const line = chunk.toString();
      received.push(line);
      if (/^(EHLO|HELO)/iu.test(line)) socket.write('250-plain.example.test\r\n250 AUTH PLAIN\r\n');
      else if (/^STARTTLS/iu.test(line)) socket.write('502 not supported\r\n');
      else if (/^QUIT/iu.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    });
  });
  await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
  const address = plain.address();
  port = typeof address === 'object' && address ? address.port : 0;
});
afterAll(() => new Promise<void>((resolve) => plain.close(() => resolve())));
const server = {
  host: '127.0.0.1',
  port: 0,
  username: 'sender@example.test',
  password: 'fixture-mail-password',
  fromAddress: 'office@example.test',
};
const mail = { to: 'reader@example.test', subject: 'Subject', lines: ['Body'] };

it('ADMIN-B61 a server that cannot encrypt the connection gets neither the password nor the message', async () => {
  await expect(deliver({ ...server, port }, 'Office', 'en', mail)).rejects.toMatchObject({
    code: 'mail_failed',
    details: { reason: 'tls' },
  });
  expect(received.some((line) => /^(AUTH|MAIL|DATA)/iu.test(line))).toBe(false);
});
it('ADMIN-B61 a server that cannot be reached is a network failure', async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const address = closed.address();
  const unused = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  await expect(deliver({ ...server, port: unused }, 'Office', 'en', mail)).rejects.toMatchObject({
    code: 'mail_failed',
    details: { reason: 'network' },
  });
});
