const https = require('https');
const http = require('http');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
        'Accept-Language': 'en-ZA,en;q=0.9',
      }
    }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

exports.handler = async (event) => {
  const target = event.queryStringParameters?.url;
  if (!target) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing url param' }) };
  }

  // Only allow yaga.co.za
  if (!target.includes('yaga.co.za')) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only yaga.co.za allowed' }) };
  }

  try {
    const result = await fetchUrl(target);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=300',
      },
      body: result.body
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
