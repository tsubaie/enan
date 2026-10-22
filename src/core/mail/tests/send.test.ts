import { beforeEach, expect, it, vi } from 'vitest';
import { deliver, mailCatalog, mailFailure, render } from '../send';
const transport = vi.hoisted(() => ({
  options: null as object | null,
  sent: [] as object[],
  failure: null as Error | null,
  closed: 0,
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: object) => {
      transport.options = options;
      return {
        sendMail: async (message: object) => {
          if (transport.failure) throw transport.failure;
          transport.sent.push(message);
        },
        close: () => {
          transport.closed++;
        },
      };
    },
  },
}));
beforeEach(() => {
  transport.options = null;
  transport.sent = [];
  transport.failure = null;
  transport.closed = 0;
});
const server = {
  host: 'smtp.example.test',
  port: 587,
  username: 'sender@example.test',
  password: 'fixture-mail-password',
  fromAddress: 'office@example.test',
};
const mail = { to: 'reader@example.test', subject: 'Subject', lines: ['First', 'Second'] };

it('ADMIN-B61 port 587 must upgrade with STARTTLS and 465 is TLS from the start; local files and URLs are off', async () => {
  await deliver(server, 'Office', 'en', mail);
  expect(transport.options).toMatchObject({
    host: server.host,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: server.username, pass: server.password },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  expect(transport.sent[0]).toMatchObject({
    from: { name: 'Office', address: server.fromAddress },
    to: mail.to,
    subject: 'Subject',
    text: 'First\n\nSecond',
  });
  expect(transport.closed).toBe(1);
  await deliver({ ...server, port: 465, username: '' }, 'Office', 'en', mail);
  expect(transport.options).toMatchObject({ port: 465, secure: true, requireTLS: false });
  expect(transport.options).not.toHaveProperty('auth');
});
it('ADMIN-B61 a failed send names its cause in a category and closes the connection', async () => {
  transport.failure = Object.assign(new Error('535 bad credentials'), { code: 'EAUTH' });
  await expect(deliver(server, 'Office', 'en', mail)).rejects.toMatchObject({
    code: 'mail_failed',
    details: { reason: 'auth' },
  });
  expect(transport.closed).toBe(1);
  expect(mailFailure(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('network');
  expect(mailFailure(Object.assign(new Error('x'), { code: 'ETLS' }))).toBe('tls');
  expect(mailFailure(Object.assign(new Error('x'), { code: 'EENVELOPE' }))).toBe('rejected');
  expect(mailFailure(new Error('unknown'))).toBe('server');
  expect(mailFailure('not an error')).toBe('server');
});
it('ADMIN-B62 a message carries its language and direction and escapes what it quotes', () => {
  const arabic = render('ar', { ...mail, lines: [mailCatalog('ar').testBody] });
  expect(arabic.html).toContain('<html lang="ar" dir="rtl">');
  expect(arabic.html).toContain('<body dir="rtl">');
  expect(arabic.text).toBe(mailCatalog('ar').testBody);
  expect(render('en', mail).html).toContain('<html lang="en" dir="ltr">');
  const quoted = render('en', { ...mail, lines: ['<script>"x" & \'y\'</script>'] });
  expect(quoted.html).toContain('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  expect(quoted.html).not.toContain('<script>');
  expect(mailCatalog('en').testSubject).not.toBe(mailCatalog('ar').testSubject);
});
