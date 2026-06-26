const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/json,*/*;q=0.9',
        'Accept-Language': 'en-ZA,en;q=0.9',
        'Accept-Encoding': 'identity',
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function decodeHtml(s) {
  return (s || '')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/');
}

function extractMeta(html, shopSlug) {
  // Title from og:image:alt — format "@shopslug - Product Title"
  const altM = html.match(/property=["']og:image:alt["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image:alt["']/i);
  let title = null;
  if (altM) {
    const raw = decodeHtml(altM[1]);
    const prefix = '@' + shopSlug + ' - ';
    title = raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw.trim();
  }

  // Full description from og:description — multiline content
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

exports.handler = async (event) => {
  if (!event.queryStringParameters) {
    return { statusCode: 400, body: 'Missing params' };
  }

  const { url, slugs, shop } = event.queryStringParameters;

  // Block non-yaga domains
  if ((url && !url.includes('yaga.co.za')) || (shop && !shop.includes('craftyandbookish') && shop.length > 50)) {
    return { statusCode: 403, body: 'Only yaga.co.za allowed' };
  }

  // BATCH MODE: fetch multiple product slugs at once, return title+description for each
  if (slugs && shop) {
    const slugList = slugs.split(',').slice(0, 20); // max 20 per batch
    const results = await Promise.all(
      slugList.map(async slug => {
        try {
          const html = await get(`https://www.yaga.co.za/${shop}/product/${slug}`);
          return { slug, ...extractMeta(html, shop) };
        } catch (e) {
          return { slug, title: null, description: null, error: e.message };
        }
      })
    );
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=600',
      },
      body: JSON.stringify(results)
    };
  }

  // SINGLE URL MODE: fetch any yaga URL and return raw text
  if (url) {
    if (!url.includes('yaga.co.za')) return { statusCode: 403, body: 'Only yaga.co.za allowed' };
    try {
      const body = await get(url);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, s-maxage=300',
        },
        body
      };
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: e.message })
      };
    }
  }

  return { statusCode: 400, body: 'Missing url or slugs param' };
};
