/*
 * server.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

/**
 * This script should only be used on a deployment server.
 * For debugging purposes please use 'npm run dev'
 */
const PeerServer = require('peer').PeerServer;

const server = PeerServer({
  debug: true,
  port: 4242,
  path: '/api',
});

server.on('connection', id => console.log(`New connection: ${id}`));
