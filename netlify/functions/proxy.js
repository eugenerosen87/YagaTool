const https = require('https');

function get(url, auth) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-ZA,en;q=0.9',
      'Accept-Encoding': 'identity',
      'x-country': 'ZA',
      'x-language': 'en',
    };
    if (auth) headers['Authorization'] = auth;

    const req = https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, auth).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function getJson(url, auth) {
  return get(url, auth).then(t => JSON.parse(t));
}

function decodeHtml(s) {
  return (s||'').replace(/&#x27;/g,"'").replace(/&#39;/g,"'")
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
}

function extractMeta(html, shopSlug) {
  const altM = html.match(/property=["']og:image:alt["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image:alt["']/i);
  let title = null;
  if (altM) {
    const raw = decodeHtml(altM[1]);
    const prefix = '@' + shopSlug + ' - ';
    title = raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw.trim();
  }
  const descM = html.match(/property=["']og:description["'][^>]+content=["']([\s\S]*?)["']\s*(?:data-next-head|\/?>)/i)
              || html.match(/content=["']([\s\S]*?)["'][^>]+property=["']og:description["']/i);
  let description = null;
  if (descM) {
    description = decodeHtml(descM[1]).trim();
    if (!title && description) title = description.split('\n').map(s=>s.trim()).filter(Boolean)[0]||null;
  }
  return { title, description };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  // Get auth token forwarded from browser
  const auth = event.headers['x-yaga-auth'] || event.headers['authorization'] || '';

  // SHOP MODE: fetch ALL pages server-side
  if (p.mode === 'shop' && p.slug) {
    const slug = p.slug;
    try {
      // First call to get shopId and total
      // Random param busts CloudFront's cache on yaga.co.za side
      const first = await getJson(
        `https://www.yaga.co.za/api/product/?shopId=${encodeURIComponent(slug)}&status=published&offset=0&limit=32&_=${Math.random()}`,
        auth
      );

      if (!first.data || !first.data.list || first.data.list.length === 0) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Shop not found or has no products' }) };
      }

      const shopId = first.data.list[0].shopId;
      const total = first.data.total;
      let all = [...first.data.list];

      // Fetch remaining pages — each with unique cache-buster
      for (let offset = 32; offset < total; offset += 32) {
        const page = await getJson(
          `https://www.yaga.co.za/api/product/?shopId=${shopId}&status=published&offset=${offset}&limit=32&_=${Math.random()}`,
          auth
        );
        if (page.data && page.data.list) all = all.concat(page.data.list);
        await new Promise(r => setTimeout(r, 150));
      }

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, total, found: all.length, products: all })
      };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // BATCH DESCRIPTIONS
  if (p.slugs && p.shop) {
    const slugList = p.slugs.split(',').slice(0, 20);
    const results = await Promise.all(slugList.map(async slug => {
      try {
        const html = await get(`https://www.yaga.co.za/${p.shop}/product/${slug}`, auth);
        return { slug, ...extractMeta(html, p.shop) };
      } catch { return { slug, title: null, description: null }; }
    }));
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(results) };
  }

  // SINGLE URL
  if (p.url) {
    if (!p.url.includes('yaga.co.za')) return { statusCode: 403, headers: CORS, body: 'Only yaga.co.za' };
    try {
      const body = await get(p.url, auth);
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }, body };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, headers: CORS, body: 'Missing params' };
};
