const BACKEND_URL = 'https://bspapp.sail-bhilaisteel.com';

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { path, ...query } = req.query;
    const pathStr = Array.isArray(path) ? path.join('/') : path || '';
    const queryStr = new URLSearchParams(query).toString();
    const url = `${BACKEND_URL}/${pathStr}${queryStr ? '?' + queryStr : ''}`;

    console.log(`Proxying: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': req.headers['user-agent'] || 'BSP-Frontend',
        'Accept': req.headers['accept'] || '*/*',
      },
    });

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    res.setHeader('Content-Type', contentType || 'application/json');
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy request failed', message: error.message });
  }
}
