const nanoid = require('nanoid');

const userId = nanoid();
const peer = new Peer(userId, {host: '127.0.0.1', port: 4242, path: '/'});

peer.on('open', id => {
  console.log('[LOG] Your ID is ' + id)
});
