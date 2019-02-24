/*
 * encryption.js
 * Copyright (c) 2019, Texx
 * License: MIT
 *     See https://github.com/texxme/Texx/blob/master/LICENSE
 */

const Dexie = require('dexie');
const moment = require('moment');
const crypto = require('crypto');
const JsSHA = require('jssha');
const fingerprintJs = require('fingerprintjs2');
const openpgp = require('openpgp');
const swal = require('sweetalert');

let db;

// compress encryption data
openpgp.config.compression = openpgp.enums.compression.zlib;

const self = module.exports = {
  fingerprint: '',

  /**
   * Generates database and tables
   * @returns Boolean
   */
  setupDatabase: () => {
    db = new Dexie('texx');
    db.version(2)
      .stores({
        own_keys: '&key_type, key_data',
        peer_keys: 'peer_id, key_data',
        messages: '++id, peer_id, message, time, self',
        contacts: 'peer_id, fingerprint',
      });

    localStorage.setItem('database', 'success');

    db.open()
      .catch((err) => {
        localStorage.setItem('database', 'failed');
        console.error(`Database failed: ${err.stack}`);
        swal('Could not create the local database!', 'Please try loading this site from a different browser', 'error');
      });

    return true;
  },

  /**
   * Generates and stores encrypted private key, public key and a revocation certificate
   * @param peerId
   * @returns {Promise<void>}
   */
  generateKeys: async (peerId) => {
    await self.generatePublicFingerprint();

    const options = {
      userIds: [{
        name: peerId,
        comment: await self.getPublicFingerprint(),
      }],
      curve: 'ed25519',
      passphrase: self.fingerprint,
    };

    openpgp.generateKey(options)
      .then(async (key) => {
        await db.own_keys.put({
          key_type: 'private_key',
          key_data: key.privateKeyArmored,
        });
        db.own_keys.put({
          key_type: 'public_key',
          key_data: key.publicKeyArmored,
        })
          .then(() => console.log('[LOG] Successfully generated and stored keys!'));
      });
  },

  /**
   * Gets the peers private key
   * @returns {Dexie.Promise<Dexie.Promise<String>>}
   */
  getPrivateKey: async () => db.own_keys.where('key_type')
    .equals('private_key')
    .limit(1)
    .toArray()
    .then(res => (res.length > 0 ? res[0].key_data : '')),

  /**
   * Gets the peers public key
   * @returns {Dexie.Promise<Dexie.Promise<String>>}
   */
  getPublicKey: async () => db.own_keys.where('key_type')
    .equals('public_key')
    .limit(1)
    .toArray()
    .then(res => (res.length > 0 ? res[0].key_data : '')),

  /**
   * Encrypts the data with a public key (e.g the one of the peer with which you're chatting)
   * @param data
   * @param publicKey
   * @returns {Promise<String>}
   */
  encrypt: async (data, publicKey) => {
    const privateKeyObj = await self.decryptPrivateKey();

    const options = {
      message: openpgp.message.fromText(data),
      publicKeys: (await openpgp.key.readArmored(publicKey)).keys,
      privateKeys: [privateKeyObj], // for signing
    };

    return openpgp.encrypt(options)
      .then(ciphertext => ciphertext.data);
  },

  /**
   * Decrypts encrypted data with own encrypted private key and
   * verifies the data with the public key
   * @param data
   * @param publicKey
   * @returns {Promise<String>}
   */
  decrypt: async (data, publicKey) => {
    const privateKeyObj = await self.decryptPrivateKey();

    const options = {
      message: await openpgp.message.readArmored(data),
      publicKeys: (await openpgp.key.readArmored(publicKey)).keys, // for verification
      privateKeys: [privateKeyObj],
    };

    return openpgp.decrypt(options)
      .then(plaintext => plaintext.data);
  },

  /**
   * Decrypts the private key
   * @returns {Promise<module:key.Key>}
   */
  decryptPrivateKey: async () => {
    const privateKeyObj = (await openpgp.key.readArmored(await self.getPrivateKey())).keys[0];
    await privateKeyObj.decrypt(self.fingerprint);
    return privateKeyObj;
  },

  /**
   * Checks whether the peer has keys
   * @returns {boolean}
   */
  isEncrypted: async () => Dexie.exists('texx')
    .then(async (exists) => {
      if (exists) {
        const hasPrivateKey = self.getPrivateKey()
          .then(res => res !== '');
        const hasPublicKey = self.getPublicKey()
          .then(res => res !== '');
        return (hasPrivateKey && hasPublicKey);
      }
      return false;
    }),

  /**
   * Encrypts a message
   * @param message
   * @returns {string}
   */
  encryptMessage: (message) => {
    const cipher = crypto.createCipher('aes-256-ctr', self.fingerprint);
    const encrypted = cipher.update(message, 'utf8', 'hex');
    console.log('[LOG] Encrypted message successfully!');
    return encrypted;
  },

  /**
   * Decrypts a message
   * @param message
   * @returns {string}
   */
  decryptMessage: (message) => {
    const cipher = crypto.createCipher('aes-256-ctr', self.fingerprint);
    const plaintext = cipher.update(message, 'hex', 'utf8');
    console.log('[LOG] Decrypted message successfully!');
    return plaintext;
  },

  /**
   * Stores a message
   * @param peerId
   * @param message
   * @param isSelf
   */
  storeMessage: async (peerId, message, isSelf = false) => {
    db.messages.put({
      peer_id: peerId,
      message: self.encryptMessage(message),
      time: new Date(),
      self: isSelf,
    })
      .then(() => console.log(`[LOG] Stored message of ${peerId}`));
  },

  /**
   * Gets the messages with a peer
   * @param peerId
   * @param publicKey
   * @returns {Promise<Array>}
   */
  getMessages: async (peerId, publicKey) => {
    console.log('[LOG] Getting messages...');
    try {
      const messages = await db.messages.where('peer_id')
        .equals(peerId)
        .reverse()
        .sortBy('id');
      const messageArray = [];
      for (let i = messages.length; i--;) {
        let plainTextMessage;
        if (messages[i].self) {
          plainTextMessage = self.decryptMessage(messages[i].message);
        } else {
          plainTextMessage = await self.decrypt(
            self.decryptMessage(messages[i].message),
            publicKey,
          );
        }
        messageArray.push({
          type: 'decrypted',
          self: messages[i].self,
          message: plainTextMessage,
          time: moment(messages[i].time)
            .fromNow(),
        });
      }
      return messageArray;
    } catch (err) {
      console.error(err);
      console.log('[LOG] No messages found!');
      return [];
    }
  },

  /**
   * Stores a peer to the contacts
   * @param peerId
   * @returns {Promise<void>}
   */
  storePeer: async (peerId) => {
    await db.contacts.put({
      peer_id: peerId,
      fingerprint: await self.getPublicKeyFingerprint(await self.getPeerPublicKey(peerId)),
    })
      .then(() => console.log(`[LOG] Stored fingerprint of ${peerId}`))
      .catch(err => console.error(err));
  },

  /**
   * Gets every stored peer
   * @returns {Promise<Array>}
   */
  getStoredPeers: async () => db.contacts.toArray(),

  /**
   * Gets the public fingerprint of a peer
   * @param peerId
   * @returns {Dexie.Promise<Dexie.Promise<Array<String>>>}
   */
  getPeerFingerprint: async peerId => db.contacts.where('peer_id')
    .equals(peerId)
    .limit(1)
    .toArray()
    .then(res => (res.length > 0 ? res[0].key_data : '')),

  /**
   * Stores the public key of a peer
   * @param peerId
   * @param key
   */
  storePeerPublicKey: async (peerId, key) => {
    await db.peer_keys.put({
      peer_id: peerId,
      key_data: key,
    })
      .then(async () => {
        await self.storePeer(peerId);
        console.log(`[LOG] Stored public key of ${peerId}`);
      })
      .catch(err => console.error(err));
  },

  /**
   * Gets and verifies the public key of a peer
   * @param peerId
   * @returns {Dexie.Promise<Dexie.Promise<String>>}
   */
  getPeerPublicKey: async peerId => db.peer_keys.where('peer_id')
    .equals(peerId)
    .limit(1)
    .toArray()
    .then(async (res) => {
      let publicKey;
      if (res.length > 0) {
        publicKey = res[0].key_data;
        const publicKeyPeerId = await self.getPublicKeyPeerId(publicKey);
        if (publicKeyPeerId !== peerId
          && await self.getPeerFingerprint(peerId)
          === await self.getPublicKeyFingerprint(await self.getPeerPublicKey(peerId))) {
          publicKey = '';
          console.error(`[LOG] Public key verification failed! The peers real identity is ${publicKeyPeerId}`);
          swal('There\'s something strange going on here!', `The peers ID could not be verified! His real ID is ${publicKeyPeerId}`, 'error');
        } else {
          console.log('[LOG] Public key verification succeeded!');
        }
      } else {
        publicKey = '';
      }
      return publicKey;
    }),

  /**
   * Gets the peer id of a public key
   * @param publicKey
   * @returns {Promise<String>}
   */
  getPublicKeyPeerId: async publicKey => (await openpgp.key.readArmored(publicKey)).keys[0]
    .getPrimaryUser()
    .then(obj => obj.user.userId.userid.replace(/ \((.+?)\)/g, '')) || '',

  /**
   * Generates the unique fingerprint of the peer using every data javascript can get
   * from the browser and the hashed passphrase of the peer
   * @param passphrase
   * @returns {Promise<void>}
   */
  generatePrivateFingerprint: passphrase => fingerprintJs.getPromise({
    excludes: {
      enumerateDevices: true,
      screenResolution: true,
      availableScreenResolution: true,
    },
  })
    .then(async (components) => {
      const fingerprintHash = fingerprintJs.x64hash128(components.map(pair => pair.value)
        .join(), 31);
      let shaObj = new JsSHA('SHA3-512', 'TEXT');
      shaObj.update(passphrase);
      const passphraseHash = shaObj.getHash('HEX');
      shaObj = new JsSHA('SHA3-512', 'TEXT');
      shaObj.update(passphraseHash);
      shaObj.update(fingerprintHash);
      self.fingerprint = shaObj.getHash('HEX');
    }),

  /**
   * Generates the unique fingerprint of the peer using every data javascript can get from the
   * browser and a randomly generated string
   * @returns {Promise<void>}
   */
  generatePublicFingerprint: () => fingerprintJs.getPromise({
    excludes: {
      enumerateDevices: true,
      screenResolution: true,
      availableScreenResolution: true,
    },
  })
    .then(async (components) => {
      const fingerprintHash = fingerprintJs.x64hash128(components.map(pair => pair.value)
        .join(), 31);
      console.log(`[LOG] Your fingerprint is: ${fingerprintHash}`);
      const shaObj = new JsSHA('SHA3-512', 'TEXT');
      shaObj.update(fingerprintHash);
      shaObj.update(Math.random()
        .toString(10));
      await db.own_keys.put({
        key_type: 'public_fingerprint',
        key_data: shaObj.getHash('HEX'),
      });
    }),

  /**
   * Gets the public fingerprint of the peer
   * @returns {Dexie.Promise<Dexie.Promise<String>>}
   */
  getPublicFingerprint: async () => db.own_keys.where('key_type')
    .equals('public_fingerprint')
    .limit(1)
    .toArray()
    .then(res => (res.length > 0 ? res[0].key_data : '')),

  /**
   * Gets the fingerprint of a public key
   * @param publicKey
   * @returns {Promise<String>}
   */
  getPublicKeyFingerprint: async publicKey => (await openpgp.key.readArmored(publicKey)).keys[0]
    .getPrimaryUser()
    .then(obj => obj.user.userId.userid.match(/\((.*)\)/)[1]) || '',

  /**
   * Resets the database/encryption
   */
  reset: () => {
    db.delete();
    localStorage.removeItem('database');
    localStorage.removeItem('peer_id');
    console.log('[LOG] Database has been deleted!');
  },
};
