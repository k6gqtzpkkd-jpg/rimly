const { createHandler } = require('./_api-adapter');
const aiStatus = require('../../api/ai-status');

exports.handler = createHandler(aiStatus);
