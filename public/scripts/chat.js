/*
 * chat.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

// general imports
const $ = require('jquery');
const swal = require('sweetalert');
const xkcdPassword = require('xkcd-password');
const encryption = require('./encryption');
const wordList = require('./wordlist');
const pinInput = require('./input_pin');

// setup vars
const host = 'meta.marvinborner.de';
let peerId;
let call;
let fingerprint;
let connectedPeer;
const connectedPeers = []; // TODO: Save new peers in array

// setup generator
const generator = new xkcdPassword();
generator.initWithWordList(wordList);

/**
 * Sets up encryption, user etc.
 */
(async () => {
  // generate peerId
  if (localStorage.getItem('peer_id') === null) {
    peerId = await generator.generate()
      .then(words => words.join('-'));
    localStorage.setItem('peer_id', peerId);
  } else {
    peerId = localStorage.getItem('peer_id');
  }

  encryption.setupDatabase();
  await evaluateKeyGeneration();
})();

/**
 * Evaluates whether a key generation is needed and initializes regarding actions
 * @returns {Promise<void>}
 */
async function evaluateKeyGeneration() {
  if (localStorage.getItem('database') === 'success' && await encryption.isEncrypted()) {
    pinInput.init(async (pin, tryCount) => {
      try {
        if (await encryption.getPublicKeyPeerId(await encryption.getPublicKey()) !== peerId
          || await encryption.getPublicKeyFingerprint(await encryption.getPublicKey())
          !== await encryption.generateFingerprint(pin)) {
          throw 'Not verified!';
        }
        fingerprint = await encryption.generateFingerprint(pin);
        await encryption.decryptPrivateKey(await encryption.getPrivateKey(), fingerprint);
        chat();
      } catch (err) { // decrypting failed
        if (tryCount === 3) {
          encryption.reset();
          console.error('Too many tries!');
          pinInput.failure('This account got removed, the site will reload.');
          setTimeout(() => location.reload(true), 1500);
        } else if (err === 'Not verified!') {
          console.error(err);
          pinInput.failure(err);
        } else {
          console.error(err);
          pinInput.failure(err.message);
        }
      }
    });
  } else {
    pinInput.init(async (pin) => {
      console.log('[LOG] No existing keys found! Generating...');
      pinInput.generate();
      fingerprint = await encryption.generateFingerprint(pin);
      await encryption.generateKeys(peerId, fingerprint)
        .then(() => chat());
    });
  }
}

/**
 * Initializes chat functions
 */
function chat() {
  // hide pin input and display chat
  $('#enter_pin')
    .hide();
  $('#chat')
    .fadeIn();

  // start the peer
  const peer = new Peer(peerId, {
    host,
    port: 4242,
    path: '/api',
    secure: true,
    debug: 0,
  });

  // Peer events
  peer.on('call', call => getMediaStream(stream => call.answer(stream))); // TODO: Ask for call accept

  peer.on('open', (id) => {
    console.log('[LOG] Your ID is', id);
    swal(
      'Hello world!',
      `Your ID is "${id}".\nYou can share this ID with your friends so they can chat with you!`,
      'success',
    );
  });

  peer.on('error', (err) => {
    console.error(err);
    if (err.type === 'network') {
      swal('Connection to server lost!', '', 'error');
    } else if (err.type === 'browser-incompatible') {
      swal('Your server is not compatible!', 'Please update or use another browser!', 'error');
    } else if (err.type === 'peer-unavailable') {
      swal('Peer could not be found!', '', 'error');
    } else if (err.type === 'unavailable-id') {
      swal('Ou snap! Your ID isn\'t available!', '', 'error');
    } else {
      swal('Unhandled Error!', `You just threw up this error: ${err.type}`, 'error');
    }
  });

  peer.on('connection', async (conn) => {
    connectedPeer = conn;
    console.log('[LOG] Connected to', connectedPeer.peer);
    swal(
      'New connection!',
      `You have successfully connected to the user ${connectedPeer.peer}!`,
      'success',
    );
    encryption.getMessages(
      connectedPeer.peer,
      await encryption.getPublicKeyPeerId(connectedPeer.peer),
      await encryption.getPrivateKey(), fingerprint,
    )
      .then(messages => messages.forEach(async data => await receivedMessage(`${data.message} - ${data.time}`, true)));
    connectedPeer.on('open', async () => transferKey(await encryption.getPublicKey()));
    connectedPeer.on('data', async (message) => {
      console.log('[LOG] Received new message!');
      await receivedMessage(message);
    });
  });

  /**
   * Connects to a peer via his id
   * @param id
   * @returns {Promise<void>}
   */
  async function connect(id) {
    const connectionId = (await generator.generate()).join('-');
    console.log('[LOG] Connecting to', id);
    console.log('[LOG] Your connection ID is', connectionId);
    connectedPeer = peer.connect(id, { label: connectionId });
    console.log('[LOG] Connected with', connectedPeer.peer);
    encryption.getMessages(
      connectedPeer.peer,
      await encryption.getPublicKeyPeerId(connectedPeer.peer),
      await encryption.getPrivateKey(), fingerprint,
    )
      .then(messages => messages.forEach(async data => await receivedMessage(`${data.message} - ${data.time}`, true)));
    connectedPeer.on('open', async () => {
      swal(`Successfully connected to "${connectedPeer.peer}"!`, '', 'success');
      transferKey(await encryption.getPublicKey());
    });
    connectedPeer.on('data', async (message) => {
      console.log('[LOG] Received new message!');
      await receivedMessage(message);
    });
  }

  /**
   * Sends a message to the peer with which you're currently connected
   * @param message
   * @returns {Promise<void>}
   */
  async function sendMessage(message) {
    console.log(`[LOG] Sending message '${message}' to ${connectedPeer.peer}`);
    connectedPeer.send({
      type: 'text',
      data: await encryption.encrypt(
        message,
        await encryption.getPeerPublicKey(connectedPeer.peer),
        await encryption.getPrivateKey(), fingerprint,
      ),
    });
    await receivedMessage(message, true);
  }

  /**
   * Transfers the (public) key to the currently connected peer
   * @param key
   */
  function transferKey(key) {
    console.log(`[LOG] Transferring key to ${connectedPeer.peer}`);
    connectedPeer.send({
      type: 'key',
      data: key,
    });
  }

  /**
   * Renders and processes the incoming messages
   * @param message
   * @param self
   */
  async function receivedMessage(message, self = false) {
    if (self) {
      $('#messages')
        .append(`<span style="color: green">${message}</span><br>`);
    } else if (message.type === 'text') {
      await encryption.storeMessage(connectedPeer.peer, message.data, fingerprint);
      await encryption.decrypt(
        message.data,
        await encryption.getPeerPublicKey(connectedPeer.peer),
        await encryption.getPrivateKey(),
        fingerprint,
      )
        .then(plaintext => $('#messages')
          .append(`<span>${plaintext}</span><br>`));
    } else if (message.type === 'key') {
      await encryption.storePeerPublicKey(connectedPeer.peer, message.data);
    }
  }

  /**
   * Sends a message of the text input field
   * @returns {Promise<String>}
   */
  async function sendMessageFromInput() {
    const messageInput = $('#message');
    return await sendMessage(messageInput.val()) & messageInput.val('');
  }

  /**
   * Shows warning modal and deletes account
   */
  function deleteAccount() {
    swal({
      title: 'Are you sure?',
      text: 'Once deleted, you will not be able to recover any messages or connections!',
      icon: 'warning',
      buttons: true,
      dangerMode: true,
    })
      .then((willDelete) => {
        if (willDelete) {
          encryption.reset();
          swal('Successfully deleted your data.', '', 'success')
            .then(() => location.reload(true));
        }
      });
  }

  /**
   * Shows modal for adding a contact
   */
  function addContact() {
    swal('Add a contact', {
      buttons: true,
      content: 'input',
      attributes: {
        placeholder: 'Contact ID',
      },
    })
      .then((contactId) => {
        if (contactId.match(/^([a-zA-Z]*-[a-zA-Z]*)+$/)) {
          connect(contactId)
            .then(() => swal({
              title: 'Connecting...',
              icon: 'info',
              text: ' ',
              buttons: false,
              closeOnClickOutside: false,
              closeOnEsc: false,
            }));
        } else {
          swal('Invalid ID!', '', 'error');
        }
      });
  }

  /**
   * Click events
   */
  $(document)
    .ready(() => {
      $('#send_message')
        .on('click', async () => await sendMessageFromInput());
      $('#message')
        .on('keydown', async (e) => {
          if (e.key === 'Enter') await sendMessageFromInput();
        });

      // FABs
      $('#add_contact')
        .on('click', () => addContact());
      $('#logout')
        .on('click', () => location.reload(true));
      $('#delete')
        .on('click', () => deleteAccount());
      $('#anonymize')
        .on('click', () => {
          if (peer.disconnected) {
            swal('Reconnected to broker server!', 'You can now connect to new peers again.', 'success')
              .then(() => peer.reconnect());
          } else {
            peer.disconnect();
            swal('Disconnected from broker server!', 'You will still be able to send and receive messages.', 'success');
          }
        });
      $('#call')
        .on('click', () => getMediaStream((stream) => {
          call = peer.call(peerId, stream); // TODO: Encrypt call
          initCall(call);
        }));
    });
}

function getMediaStream(callback) {
  navigator.getUserMedia(
    {
      audio: true,
      video: {
        width: 1280,
        height: 720,
      },
    },
    stream => callback(stream),
    err => console.error(err),
  );
}

function initCall(call) {
  call.on('stream', (stream) => {
    const video = document.querySelector('video');
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
    };
  });
}
