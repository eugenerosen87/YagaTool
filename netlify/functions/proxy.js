const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
        'Accept-Language': 'en-ZA,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      }
    };
    const req = https.get(url, opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

function getJson(url) {
  return get(url).then(t => JSON.parse(t));
}

function decodeHtml(s) {
  return (s || '')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/');
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
    if (!title && description) {
      title = description.split('\n').map(s => s.trim()).filter(Boolean)[0] || null;
    }
  }
  return { title, description };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};

  // SHOP MODE: fetch ALL products for a shop in one go
  // Returns { shopId, total, products: [...] }
  if (p.mode === 'shop' && p.slug) {
    const slug = p.slug;
    try {
      // Use shopId directly if provided, otherwise get it from first page using shopId param we already know
      // First page with a unique timestamp to bust any server-side cache
      const ts = Date.now();
      const firstUrl = `https://www.yaga.co.za/api/product/?shopId=${encodeURIComponent(slug)}&status=published&offset=0&limit=32&_=${ts}`;
      const first = await getJson(firstUrl);

      // Extract shopId from returned products
      if (!first.data || !first.data.list || first.data.list.length === 0) {
        // Try with activeSlug parameter
        const alt = await getJson(`https://www.yaga.co.za/api/product/?activeSlug=${encodeURIComponent(slug)}&status=published&offset=0&limit=32&_=${ts+1}`);
        if (!alt.data || !alt.data.list || alt.data.list.length === 0) {
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'No products found' }) };
        }
        first.data = alt.data;
      }

      const shopId = first.data.list[0].shopId;
      const total = first.data.total;
      let allProducts = [...first.data.list];

      // Fetch remaining pages using real shopId
      const limit = 32;
      for (let offset = limit; offset < total; offset += limit) {
        const ts2 = Date.now();
        const page = await getJson(
          `https://www.yaga.co.za/api/product/?shopId=${shopId}&status=published&offset=${offset}&limit=${limit}&_=${ts2}`
        );
        if (page.data && page.data.list) {
          allProducts = allProducts.concat(page.data.list);
        }
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      }

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, total, products: allProducts })
      };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // BATCH DESCRIPTIONS: fetch og:description for multiple slugs
  if (p.slugs && p.shop) {
    const slugList = p.slugs.split(',').slice(0, 20);
    const results = await Promise.all(
      slugList.map(async slug => {
        try {
          const html = await get(`https://www.yaga.co.za/${p.shop}/product/${slug}`);
          return { slug, ...extractMeta(html, p.shop) };
        } catch (e) {
          return { slug, title: null, description: null };
        }
      })
    );
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(results)
    };
  }

  // SINGLE URL: proxy any yaga URL
  if (p.url) {
    if (!p.url.includes('yaga.co.za')) return { statusCode: 403, headers: CORS, body: 'Only yaga.co.za' };
    try {
      const body = await get(p.url);
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }, body };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 400, headers: CORS, body: 'Missing params' };
};
