const { createHandler } = require('./_api-adapter');
const ocr = require('../../api/ocr');

exports.handler = createHandler(ocr);
