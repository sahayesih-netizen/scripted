const appEntry = process.env.APP_ENTRY || 'server-a.js';

await import(`./${appEntry}`);
