/**
 * Headless smoke test: serves the production build, opens it in headless Chrome with a fake
 * webcam, collects console output and the HUD text for a few seconds, and saves a screenshot.
 *
 *   npm run build && npm run smoke -- [url-query] [seconds] [screenshot.png]
 *   FAKE_VIDEO=face.y4m npm run smoke -- "?diag=1"   # feed a video file as the webcam
 *
 * Exits non-zero on uncaught page exceptions. Useful for checking the app boots end to end
 * (worker, wasm, camera plumbing) without a person in front of a camera.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4173;
const query = process.argv[2] ?? '?viewport=full';
const seconds = Number(process.argv[3] ?? '12');
const shot = process.argv[4] ?? 'smoke.png';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(url: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error(`server at ${url} did not come up`);
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, (m: CdpMessage) => void>();
  readonly events: ((m: CdpMessage) => void)[] = [];

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as CdpMessage;
      if (m.id !== undefined) {
        this.pending.get(m.id)?.(m);
        this.pending.delete(m.id);
      } else {
        for (const e of this.events) e(m);
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, (m) =>
        m.error ? rej(new Error(m.error.message)) : res(m.result ?? {}),
      );
    });
  }
}

async function main(): Promise<number> {
  const procs: ChildProcess[] = [];
  const kill = () => procs.forEach((p) => p.kill());
  process.on('exit', kill);

  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  procs.push(preview);
  await waitFor(`http://localhost:${PORT}/`);

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(process.env.FAKE_VIDEO
        ? [`--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO}`]
        : []),
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1512,982',
      '--no-first-run',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  procs.push(chrome);
  const wsUrl = await new Promise<string>((res, rej) => {
    let buf = '';
    chrome.stderr.on('data', (d: Buffer) => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m?.[1]) res(m[1]);
    });
    setTimeout(() => rej(new Error('chrome did not start')), 10000);
  });
  const port = new URL(wsUrl).port;
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  const cdp = new Cdp(ws);
  let exceptions = 0;
  cdp.events.push((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const p = m.params as { type: string; args: { value?: unknown; description?: string }[] };
      const text = p.args
        .map((a) => (a.value !== undefined ? JSON.stringify(a.value) : (a.description ?? '')))
        .join(' ');
      console.log(`[console.${p.type}] ${text}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions++;
      const p = m.params as {
        exceptionDetails: { text: string; exception?: { description?: string } };
      };
      console.log(
        `[exception] ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`,
      );
    } else if (m.method === 'Log.entryAdded') {
      const p = m.params as { entry: { level: string; text: string } };
      if (!/GL Driver|ReadPixels/.test(p.entry.text))
        console.log(`[log.${p.entry.level}] ${p.entry.text}`);
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/${query}` });
  await sleep(seconds * 1000);

  const hud = await cdp.send('Runtime.evaluate', {
    expression: 'document.querySelector("pre")?.textContent ?? "(no hud)"',
    returnByValue: true,
  });
  console.log('--- HUD ---');
  console.log((hud.result as { value: string }).value);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = resolve(shot);
  writeFileSync(out, Buffer.from((png as { data: string }).data, 'base64'));
  console.log(`screenshot: ${out}`);
  ws.close();
  kill();
  return exceptions > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(2);
  },
);
