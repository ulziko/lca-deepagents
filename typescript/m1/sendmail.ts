// send-gmail.ts
// Sends an email through Gmail's SMTP server over TLS (Node's tls module uses OpenSSL).
//
// Run:  npx tsx send-gmail.ts      (or compile with tsc and run with node)
//
// NOTE: Gmail requires an App Password (Google Account > Security > 2-Step Verification > App passwords).
// Your normal Google password will be rejected.

import * as tls from 'node:tls';
import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import { config } from "dotenv";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env"), override: true });
const HOST = 'smtp.gmail.com';
const PORT = 465; // implicit TLS

interface MailOptions {
  user: string;
  pass: string;
  to: string;
  subject: string;
  text: string;
}

// ---------- prompts ----------
export function ask(question: string, hidden = false): Promise<string> {
  return new Promise<string>((resolve) => {
    let muted = false;

    // Output stream that stops echoing once `muted` is set (used for passwords)
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });

    rl.question(question, (answer: string) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });

    // The prompt itself has been written by now; mute everything typed after it
    muted = hidden;
  });
}

// ---------- minimal SMTP client ----------
function connect(): Promise<tls.TLSSocket> {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect(
      { host: HOST, port: PORT, servername: HOST, minVersion: 'TLSv1.2' },
      () => {
        if (!socket.authorized) {
          reject(new Error(`TLS certificate not trusted: ${socket.authorizationError}`));
          return;
        }
        resolve(socket);
      }
    );
    socket.once('error', reject);
  });
}

function makeReader(socket: tls.TLSSocket): () => Promise<string> {
  let buf = '';
  const waiters: Array<(response: string) => void> = [];

  function flush(): void {
    while (waiters.length > 0) {
      const lines = buf.split('\r\n');
      // A response is complete at the first line shaped like "250 text" (space after the code)
      const idx = lines.slice(0, -1).findIndex((line) => /^\d{3} /.test(line));
      if (idx === -1) return;

      const response = lines.slice(0, idx + 1).join('\r\n');
      buf = lines.slice(idx + 1).join('\r\n');
      waiters.shift()!(response);
    }
  }

  socket.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    flush();
  });

  return () =>
    new Promise<string>((resolve) => {
      waiters.push(resolve);
      flush();
    });
}

async function sendMail({ user, pass, to, subject, text }: MailOptions): Promise<void> {
  const socket = await connect();
  const read = makeReader(socket);

  const expect = async (code: number, label: string): Promise<string> => {
    const res = await read();
    if (!res.startsWith(String(code))) {
      throw new Error(`${label} failed: ${res}`);
    }
    return res;
  };

  const cmd = async (line: string, code: number, label: string): Promise<string> => {
    socket.write(`${line}\r\n`);
    return expect(code, label);
  };

  try {
    await expect(220, 'Greeting');
    await cmd('EHLO localhost', 250, 'EHLO');
    await cmd('AUTH LOGIN', 334, 'AUTH LOGIN');
    await cmd(Buffer.from(user).toString('base64'), 334, 'Username');
    await cmd(Buffer.from(pass).toString('base64'), 235, 'Authentication');
    await cmd(`MAIL FROM:<${user}>`, 250, 'MAIL FROM');
    await cmd(`RCPT TO:<${to}>`, 250, 'RCPT TO');
    await cmd('DATA', 354, 'DATA');

    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const body = text
      .replace(/\r?\n/g, '\r\n')
      .replace(/^\./gm, '..'); // dot-stuffing

    const message = [
      `From: ${user}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
    ].join('\r\n');

    await cmd(`${message}\r\n.`, 250, 'Message body');
    await cmd('QUIT', 221, 'QUIT');
    console.log('Email sent successfully.');
  } finally {
    socket.end();
  }
}

export async function sendGmail(to: string,subject: string ,text: string ): Promise<void> {
  try {
    const user = process.env.GMAIL_USERNAME
    const pass = process.env.GMAIL_PASS

    if (!user || !pass) {
      throw new Error('Set GMAIL_USERNAME and GMAIL_PASS in your environment or .env file');
    }
    if (!to || !subject || !text) {
      throw new Error('Recipient, subject, and text are required');
    }
    await sendMail({ user, pass, to, subject, text });
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
