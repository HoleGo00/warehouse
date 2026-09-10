import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const [scenario, entry, directory] = process.argv.slice(2);
const multer = createRequire(import.meta.url)(entry);
const boundary = 'warehouse-security-test';
const streams = [];
const createWriteStream = fs.createWriteStream;

// Observe real disk handles in this isolated process; do not mock storage or IO.
fs.createWriteStream = (...args) => {
  const stream = createWriteStream(...args);
  streams.push(stream);
  return stream;
};

const options = {};
if (scenario === 'array-index-limit') options.limits = { fieldArrayIndexLimit: 4 };
if (scenario === 'async-file-size') {
  options.dest = directory;
  options.limits = { fileSize: 16 };
  options.fileFilter = (_req, _file, callback) => {
    void delay(25).then(() => callback(null, true));
  };
}
if (scenario === 'aborted-disk-upload' || scenario === 'truncated-disk-upload') {
  options.dest = directory;
}

const upload = multer(options).single('file');
let completedUploads = 0;
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.end('healthy');
    return;
  }
  upload(req, res, (error) => {
    completedUploads += 1;
    res.statusCode = error ? 400 : 200;
    res.end(JSON.stringify({ code: error?.code, size: req.file?.size }));
  });
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

function send(body, path = '/upload') {
  return new Promise((done, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers:
          body === undefined
            ? {}
            : {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(body),
              },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          done({ status: res.statusCode, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function fields(names) {
  return (
    names
      .map((name) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\nx\r\n`)
      .join('') + `--${boundary}--\r\n`
  );
}

function fileHeader() {
  return `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await delay(10);
  }
}

try {
  switch (scenario) {
    case 'crafted-field-names': {
      const result = await send(fields(['items[4294967294]', 'items[]']));
      assert.equal(result.status, 400);
      assert.equal(JSON.parse(result.body).code, 'INVALID_FIELD_NAME');
      break;
    }
    case 'array-index-limit': {
      assert.equal((await send(fields(['items[4]']))).status, 200);
      for (const index of [5, 4294967294]) {
        const result = await send(fields([`items[${index}]`, 'items[key]']));
        assert.equal(result.status, 400);
        assert.equal(JSON.parse(result.body).code, 'LIMIT_FIELD_ARRAY_INDEX');
      }
      break;
    }
    case 'async-file-size': {
      const result = await send(fileHeader() + 'a'.repeat(32) + `\r\n--${boundary}--\r\n`);
      assert.equal(result.status, 400);
      assert.equal(JSON.parse(result.body).code, 'LIMIT_FILE_SIZE');
      assert.deepEqual(fs.readdirSync(directory), []);
      break;
    }
    case 'aborted-disk-upload':
    case 'truncated-disk-upload': {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const partial = fileHeader() + 'a'.repeat(64 * 1024);
        const aborted = scenario === 'aborted-disk-upload';
        const req = request({
          hostname: '127.0.0.1',
          port,
          path: '/upload',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': Buffer.byteLength(partial) + (aborted ? 1024 : 1),
          },
        });
        req.on('error', () => {
          /* Destroying the client socket intentionally raises an error. */
        });
        req.on('response', (res) => res.resume());
        req.write(partial);
        await waitFor(
          () => streams.length === attempt + 1 && streams[attempt].bytesWritten > 0,
          'actual disk write',
        );
        if (aborted) req.destroy();
        else req.end('x');
        await waitFor(
          () => streams[attempt].closed && completedUploads === attempt + 1,
          'closed file handle and upload cleanup callback',
        );
        assert.deepEqual(fs.readdirSync(directory), []);
      }
      assert.equal(streams.length, 3);
      assert.ok(streams.every((stream) => stream.closed));
      break;
    }
    default:
      assert.fail(`Unknown security scenario: ${scenario}`);
  }
  assert.deepEqual(await send(undefined, '/health'), { status: 200, body: 'healthy' });
  process.stdout.write(JSON.stringify({ scenario, ok: true, closedStreams: streams.length }));
} finally {
  fs.createWriteStream = createWriteStream;
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
