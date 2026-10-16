const CACHE = 'meal-planner-v3';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const { request } = e;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never intercept Supabase API calls
    if (url.hostname.endsWith('.supabase.co')) return;

    // Network-first for HTML/navigations
    const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');
    if (request.mode === 'navigate' || acceptsHtml) {
        e.respondWith(
            fetch(request)
                .then(res => {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(request, copy));
                    return res;
                })
                .catch(() =>
                    caches.match(request).then(r => r || caches.match('./index.html'))
                )
        );
        return;
    }

    // Cache-first for everything else
    e.respondWith(
        caches.match(request).then(cached => cached || fetch(request).then(res => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(request, copy));
            }
            return res;
        }))
    );
});