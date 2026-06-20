function netlifyHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS, POST'
  };
}

function createReq(event) {
  return {
    method: event.httpMethod,
    headers: event.headers || {},
    query: event.queryStringParameters || {},
    body: event.body ? JSON.parse(event.body) : {}
  };
}

function createRes(headers) {
  const result = {
    statusCode: 200,
    headers,
    body: ''
  };

  return {
    result,
    setHeader(key, value) {
      result.headers[key] = value;
    },
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(payload) {
      result.headers['Content-Type'] = 'application/json; charset=utf-8';
      result.body = JSON.stringify(payload);
      return result;
    },
    send(payload) {
      if (typeof payload === 'object') return this.json(payload);
      result.body = String(payload ?? '');
      return result;
    },
    end(payload = '') {
      result.body = String(payload ?? '');
      return result;
    }
  };
}

function createHandler(apiHandler) {
  return async function handler(event) {
    const headers = netlifyHeaders();
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers, body: '' };
    }

    try {
      const req = createReq(event);
      const res = createRes(headers);
      await apiHandler(req, res);
      return res.result;
    } catch (error) {
      return {
        statusCode: 500,
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Function error', details: error.message })
      };
    }
  };
}

module.exports = { createHandler };
