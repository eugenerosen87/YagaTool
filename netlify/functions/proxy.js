const https = require('https');

exports.handler = async (event) => {
  const path = (event.path || '').replace(/^\/?api\//, '');
  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const url = `https://www.yaga.co.za/api/${path}${qs}`;

  const body = await new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity'
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=120'
    },
    body
  };
};
