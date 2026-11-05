import { spawn } from 'node:child_process';

export const inject = ['connection'];

export function apply(ctx) {
  ctx.effect(() => {
    return ctx.connection.fetch.register({
      path: '/api/local/trigger-snipping',
      methods: ['POST'],
      fetch: async () => {
        if (process.platform !== 'win32') {
          return new Response(JSON.stringify({ ok: false, error: 'Only Windows is supported' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const child = spawn('explorer.exe', ['ms-screenclip:'], {
            detached: true,
            stdio: 'ignore',
          });
          child.on('error', (err) => {
            console.error('[screenshot-button] spawn error:', err);
          });
          child.unref();

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ ok: false, error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    });
  }, 'screenshot-button: trigger route');
}
