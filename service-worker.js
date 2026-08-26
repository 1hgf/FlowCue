'use strict';

const CACHE_PREFIX = 'flowcue-shell-';
const CACHE_NAME = 'flowcue-shell-2026.08.26.1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('__network') || request.cache === 'no-store') {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('./index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('./index.html'))
      || (await cache.match('./'))
      || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}

self.addEventListener('message', (event) => {
  const reply = (payload) => event.ports[0]?.postMessage(payload);
  if (event.data?.type === 'REFRESH_CACHE') {
    event.waitUntil(
      refreshCache()
        .then(() => reply({ ok: true, version: CACHE_NAME }))
        .catch((error) => reply({ ok: false, error: error?.message || 'CACHE_REFRESH_FAILED' }))
    );
  } else if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(
      clearFlowCueCaches()
        .then(() => reply({ ok: true }))
        .catch((error) => reply({ ok: false, error: error?.message || 'CACHE_CLEAR_FAILED' }))
    );
  } else if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting().then(() => reply({ ok: true })));
  }
});

async function refreshCache() {
  const cache = await caches.open(CACHE_NAME);
  const requests = APP_SHELL.map((url) => new Request(url, { cache: 'reload' }));
  await cache.addAll(requests);
}

async function clearFlowCueCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX))
      .map((name) => caches.delete(name))
  );
}
