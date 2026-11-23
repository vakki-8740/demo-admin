const CACHE_NAME = 'github-project-manager-v3';
const APP_SHELL = [
  '/', '/index.html', '/style.css', '/script.js', '/manifest.webmanifest',
  '/icons/app-icon-192.png', '/icons/app-icon-512.png', '/icons/app-icon.svg', '/icons/favicon.svg', '/icons/github-logo.svg',
  '/icons/github.svg', '/icons/home.svg', '/icons/cloud-upload.svg', '/icons/folder.svg',
  '/icons/edit-pencil.svg', '/icons/clock.svg', '/icons/settings.svg', '/icons/refresh.svg',
  '/icons/page-plus.svg', '/icons/arrow-right.svg', '/icons/eye.svg', '/icons/eye-closed.svg',
  '/icons/git-branch.svg', '/icons/code.svg', '/icons/trash.svg', '/icons/download.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match('/index.html'))));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    });
  }));
});
