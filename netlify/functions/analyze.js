const { createHandler } = require('./_api-adapter');
const analyze = require('../../api/analyze');

exports.handler = createHandler(analyze);
