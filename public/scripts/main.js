const nanoid = require('nanoid');

var peer = new Peer(nanoid(), {host: '127.0.0.1', port: 4242, path: '/'});

