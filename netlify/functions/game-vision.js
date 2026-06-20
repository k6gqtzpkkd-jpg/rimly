const { createHandler } = require('./_api-adapter');
const gameVision = require('../../api/game-vision');

exports.handler = createHandler(gameVision);
