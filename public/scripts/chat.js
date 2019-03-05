/*
 * chat.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

// general imports
const $ = jQuery = require('jquery');
require('jquery-ui-bundle');
const util = require('util');
const swal = require('sweetalert');
const xkcdPassword = require('xkcd-password');
const dragDrop = require('drag-drop');
const encryption = require('./encryption');
const wordList = require('./wordlist');
const pinInput = require('./input_pin');

// setup vars
const host = 'meta.marvinborner.de';
let peerId;
let currentPeerIndex; // defines which peer connection is currently used
const connectedPeers = [];

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
          !== await encryption.getPublicFingerprint()) {
          throw 'Not verified!';
        }
        await encryption.generatePrivateFingerprint(pin);
        await encryption.decryptPrivateKey(); // try decrypting
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
      await encryption.generatePrivateFingerprint(pin);
      await encryption.generateKeys(peerId)
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

  // init file sending support
  initFileSending();

  // start the peer
  const peer = new Peer(peerId, {
    host,
    port: 8080,
    path: '/api',
    secure: true,
    debug: 0,
  });

  // Peer events
  peer.on('call', (call) => {
    getMediaStream(stream => call.answer(stream));
    call.on('stream', (stream) => {
      const video = document.querySelector('audio');
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
      };
    });
  }); // TODO: Ask for call accept

  peer.on('open', async (id) => {
    await refreshContactList();
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
    } else if (err.type === 'disconnected') {
      swal('Not connected to the server!', 'Please reconnect using the anonymize button.', 'error');
    } else {
      swal('Unhandled Error!', `You just threw up this error: ${err.type}`, 'error');
    }
  });

  // This event gets fired when the initiator wants to connect to the peer
  peer.on('connection', (conn) => {
    swal({
      title: 'Connection request',
      text: `The user "${conn.peer}" wants to connect to you.\nThis gets cancelled in 3 seconds.`,
      timer: 3000,
      icon: 'info',
      buttons: true,
    })
      .then(async (accepted) => {
        if (accepted) {
          currentPeerIndex = connectedPeers.length + 1;
          connectedPeers[currentPeerIndex] = conn;
          connectedPeers[currentPeerIndex].send({
            type: 'state',
            data: 'accepted',
          });
          connectedPeers[currentPeerIndex].on('data', async (data) => {
            if (data.type === 'state' && data.data === 'received') {
              console.log('[LOG] Connected to', connectedPeers[currentPeerIndex].peer);
              swal(
                'New connection!',
                `You have successfully connected to the user "${connectedPeers[currentPeerIndex].peer}"!`,
                'success',
              );
              encryption.getMessages(
                connectedPeers[currentPeerIndex].peer,
                await encryption.getPeerPublicKey(connectedPeers[currentPeerIndex].peer),
              )
                .then(messages => messages.forEach(async (messageData) => {
                  await receivedMessage(messageData);
                }));
              transferKey(await encryption.getPublicKey());
            } else if (data.type !== 'state') {
              console.log('[LOG] Received new message!');
              await receivedMessage(data);
            }
          });
        } else {
          console.log(`[LOG] Declined connection request of ${conn.peer}`);
          conn.send({
            type: 'state',
            data: 'declined',
          });
          // .then(() => conn.close()); TODO: Add promise for connection closing
        }
      });
  });

  /**
   * Connects the initiator to a peer via his id
   * @param id
   * @returns {Promise<void>}
   */
  async function connect(id) {
    const connectionId = (await generator.generate()).join('-');
    console.log('[LOG] Connecting to', id);
    console.log('[LOG] Your connection ID is', connectionId);
    const conn = peer.connect(id, { label: connectionId });
    conn.on('data', async (data) => {
      if (data.type === 'state' && data.data === 'accepted') {
        currentPeerIndex = connectedPeers.length + 1;
        connectedPeers[currentPeerIndex] = conn;
        connectedPeers[currentPeerIndex].send({
          type: 'state',
          data: 'received',
        });
        console.log('[LOG] Connected to', connectedPeers[currentPeerIndex].peer);
        swal(`Successfully connected to "${connectedPeers[currentPeerIndex].peer}"!`, '', 'success');
        transferKey(await encryption.getPublicKey());
        encryption.getMessages(
          connectedPeers[currentPeerIndex].peer,
          await encryption.getPeerPublicKey(connectedPeers[currentPeerIndex].peer),
        )
          .then(messages => messages.forEach(async (messageData) => {
            await receivedMessage(messageData);
          }));
        connectedPeers[currentPeerIndex].on('close', async () => {
          await refreshContactList();
          swal('Disconnected!', `The connection to "${connectedPeers[currentPeerIndex].peer}" has been closed!`, 'error');
        });
      } else if (data.type === 'state') {
        swal('Declined!', `The user "${conn.peer}" has declined your connection request.`, 'error');
        conn.close();
      } else {
        console.log('[LOG] Received new message!');
        await receivedMessage(data);
      }
    });
  }

  /**
   * Sends a message to the peer with which you're currently connected
   * @param message
   * @returns {Promise<void>}
   */
  async function sendMessage(message) {
    try {
      console.log(`[LOG] Sending message '${message}' to ${connectedPeers[currentPeerIndex].peer}`);
      connectedPeers[currentPeerIndex].send({
        type: 'text',
        data: await encryption.encrypt(
          message,
          await encryption.getPeerPublicKey(connectedPeers[currentPeerIndex].peer),
        ),
      });
      await receivedMessage(message, true);
    } catch (err) {
      console.error(err);
      swal('Not connected!', 'You aren\'t connected to another peer right now.', 'error');
    }
  }

  /**
   * Transfers the (public) key to the currently connected peer
   * @param key
   */
  function transferKey(key) {
    console.log(`[LOG] Transferring key to ${connectedPeers[currentPeerIndex].peer}`);
    connectedPeers[currentPeerIndex].send({
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
        .append(`<span style="color: green">${sanitizeText(message)}</span><br>`);
      await encryption.storeMessage(connectedPeers[currentPeerIndex].peer, message, true);
    } else if (message.type === 'text') {
      await encryption.storeMessage(connectedPeers[currentPeerIndex].peer, message.data);
      await encryption.decrypt(
        message.data,
        await encryption.getPeerPublicKey(connectedPeers[currentPeerIndex].peer),
      )
        .then(plaintext => $('#messages')
          .append(`<span>${sanitizeText(plaintext)}</span><br>`));
    } else if (message.type === 'decrypted') {
      if (message.self) {
        $('#messages')
          .append(`<span style="color: green">${sanitizeText(message.message)} - ${message.time}</span><br>`);
      } else {
        $('#messages')
          .append(`<span>${sanitizeText(message.message)} - ${message.time}</span><br>`);
      }
    } else if (message.type === 'file') {
      await processFile(message);
    } else if (message.type === 'key') {
      encryption.storePeerPublicKey(connectedPeers[currentPeerIndex].peer, message.data)
        .then(() => refreshContactList());
    } else {
      console.error('Received unsupported message!');
    }
  }

  /**
   * Sends a message of the text input field
   * @returns {Promise<void>}
   */
  async function sendMessageFromInput() {
    const messageInput = $('#message');
    if (messageInput.val()
      .replace(/\s/g, '') !== '') {
      await sendMessage(messageInput.val());
    }
    messageInput.val('');
  }

  /**
   * Initialized the file sending feature
   * TODO: Encrypt files
   */
  function initFileSending() {
    dragDrop('body', (files) => {
      if (connectedPeers[currentPeerIndex] !== undefined) {
        files.forEach(async (file) => {
          const fileObj = {
            type: 'file',
            info: {
              name: file.name,
              size: file.size,
              type: file.type,
            },
            data: file,
          };
          await processFile(fileObj, true);
          connectedPeers[currentPeerIndex].send(fileObj);
          console.log('[LOG] File sent!'); // TODO: Make it async!
        });
      }
    });
  }

  /**
   * Processes a received/sent file
   * @param file
   * @param self
   */
  async function processFile(file, self = false) {
    console.log(file.info);
    const blob = new Blob([file.data], { type: file.info.type });
    const blobUrl = URL.createObjectURL(blob);
    const fileName = `${file.info.name} (${formatBytes(file.info.size)})`;
    // REMEMBER: Use 'self' instead of 'true' when encrypting files! => TODO: Fix 'self' in files
    await encryption.storeMessage(connectedPeers[currentPeerIndex].peer, fileName, true); // TODO: Store files
    $('#messages')
      .append(`<a href="${blobUrl}" download="${sanitizeText(file.info.name)}">${sanitizeText(fileName)}</a><br>`);
    // TODO: Show file preview
  }

  /**
   * Formats bytes to a human readable string
   * @param bytes
   * @returns {string}
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / (1024 ** i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Sanitizes a given string to prevent html/sql/... injection
   * @param text
   * @returns {string}
   */
  function sanitizeText(text) {
    return text.replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
   * Refreshes the contact list at the left side of the chat
   * @returns {Promise<void>}
   */
  async function refreshContactList() {
    try {
      (await encryption.getStoredPeers()).forEach((peerObj) => {
        if (!$(`[data-peer="${peerObj.peer_id}"]`).length) { // Contact isn't already there
          $('#contact_list')
            .append(`
            <column>
                <button
                    class="button action-button is-big is-outlined is-white" 
                    data-peer="${peerObj.peer_id}">
                    <i class="fas fa-user"></i>
                </button>
            </column>
        `);
          $(`[data-peer="${peerObj.peer_id}"]`)
            .off('click')
            .on('click', () => connect(peerObj.peer_id));
        }
      });
      $('[data-peer]')
        .removeClass('is-success');
      if (connectedPeers[currentPeerIndex] !== undefined) {
        $(`[data-peer="${connectedPeers[currentPeerIndex].peer}"]`)
          .addClass('is-success');
      }
    } catch (err) {
      console.error(err);
    }
    console.log('[LOG] Refreshed contact list');
  }

  /**
   * Shows modal for adding a contact
   * TODO: Fix selecting from dropdown on enter
   */
  function addContact() {
    let idComplete = false;
    const observer = new MutationObserver(() => {
      $('#contact_id_input')
        .on('keydown', (event) => {
          if (event.keyCode === $.ui.keyCode.TAB) {
            event.preventDefault();
          } else if (!idComplete && event.keyCode === $.ui.keyCode.ENTER) {
            event.preventDefault();
          }
        })
        .autocomplete({
          minLength: 1,
          source(request, response) {
            response($.ui.autocomplete.filter(
              wordList, request.term.split(/-\s*/)
                .pop(),
            ));
          },
          focus() {
            return false;
          },
          select(event, ui) {
            const words = this.value.split(/-\s*/);
            words.pop();
            if (words.length !== 3) {
              words.push(ui.item.value);
              words.push('');
              this.value = words.join('-');
            } else {
              this.value = `${words.join('-')}-${ui.item.value}`;
              idComplete = true;
            }
            return false;
          },
        });
    });

    observer.observe($('body')
      .get(0), {
      attributes: true,
      childList: true,
      subtree: true,
    });

    swal('Add a contact', {
      buttons: true,
      content: {
        element: 'input',
        attributes: {
          id: 'contact_id_input',
          placeholder: 'Contact ID',
        },
      },
    })
      .then((contactId) => {
        observer.disconnect();
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
        .on('click', async () => sendMessageFromInput());
      $('#message')
        .on('keydown', async (e) => {
          if (e.key === 'Enter') await sendMessageFromInput();
        });

      // FABs
      $('#add_contact')
        .on('click', () => addContact());
      $('#logout')
        .on('click', () => {
          if (currentPeerIndex in connectedPeers) connectedPeers[currentPeerIndex].close();
          location.reload(true);
        });
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
          peer.call(connectedPeers[currentPeerIndex].peer, stream); // TODO: Encrypt call
        }));
    });
}

/**
 * Gets a video and audio stream
 * @param callback
 */
function getMediaStream(callback) {
  navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false, // REMEMBER: Activate video stream
  })
    .then(stream => callback(stream))
    .catch(err => console.error(err.message));
}
