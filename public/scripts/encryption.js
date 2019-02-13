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
        messages: '++id, peer_id, message, time',
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
   * @param fingerprint
   * @returns {Promise<void>}
   */
  generateKeys: async (peerId, fingerprint) => {
    await self.generatePublicFingerprint();

    const options = {
      userIds: [{
        name: peerId,
        comment: await self.getPublicFingerprint(),
      }],
      curve: 'ed25519',
      passphrase: fingerprint,
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
   * @returns {Dexie.Promise<Dexie.Promise<string>>}
   */
  getPrivateKey: async () => db.own_keys.where('key_type')
    .equals('private_key')
    .limit(1)
    .toArray()
    .then(res => (res.length > 0 ? res[0].key_data : '')),

  /**
   * Gets the peers public key
   * @returns {Dexie.Promise<Dexie.Promise<string>>}
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
   * @param privateKey
   * @param fingerprint
   * @returns {Promise<String>}
   */
  encrypt: async (data, publicKey, privateKey, fingerprint) => {
    const privateKeyObj = await self.decryptPrivateKey(privateKey, fingerprint);

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
   * @param privateKey
   * @param fingerprint
   * @returns {Promise<String>}
   */
  decrypt: async (data, publicKey, privateKey, fingerprint) => {
    const privateKeyObj = await self.decryptPrivateKey(privateKey, fingerprint);

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
   * @param privateKey
   * @param fingerprint
   * @returns {Promise<module:key.Key>}
   */
  decryptPrivateKey: async (privateKey, fingerprint) => {
    const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    await privateKeyObj.decrypt(fingerprint);
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
   * @param fingerprint
   * @returns {string}
   */
  encryptMessage: (message, fingerprint) => {
    const cipher = crypto.createCipher('aes-256-ctr', fingerprint);
    const plaintext = cipher.update(message, 'utf8', 'hex');
    console.log('[LOG] Encrypted message successfully!');
    return plaintext + cipher.final('hex');
  },

  /**
   * Decrypts a message
   * @param message
   * @param fingerprint
   * @returns {string}
   */
  decryptMessage: (message, fingerprint) => {
    const cipher = crypto.createCipher('aes-256-ctr', fingerprint);
    const plaintext = cipher.update(message, 'hex', 'utf8');
    console.log('[LOG] Decrypted message successfully!');
    return plaintext + cipher.final('utf8');
  },

  /**
   * Stores a message // TODO: Store and get own messages too
   * @param peerId
   * @param message
   * @param fingerprint
   */
  storeMessage: async (peerId, message, fingerprint) => {
    db.messages.put({
      peer_id: peerId,
      message: self.encryptMessage(message, fingerprint),
      time: new Date(),
    })
      .then(() => console.log(`[LOG] Stored message of ${peerId}`));
  },

  /**
   * Gets the messages
   * @param peerId
   * @param publicKey
   * @param privateKey
   * @param fingerprint
   * @returns {Promise<Array>}
   */
  getMessages: async (peerId, publicKey, privateKey, fingerprint) => {
    console.log('[LOG] Getting messages...');
    try {
      const messages = await db.messages.where('peer_id')
        .equals(peerId)
        .sortBy('id');
      const messageArray = [];
      for (let i = messages.length; i--;) {
        await messageArray.push({
          message: await self.decrypt(
            decryptMessage(messages[i].message, fingerprint), publicKey, privateKey, fingerprint,
          ),
          time: moment(messages[i].time)
            .fromNow(),
        });
      }
      return messageArray;
    } catch (err) {
      console.log('[LOG] No messages found!');
      return [];
    }
  },

  /**
   * Saves a peer to the contacts
   * @param peerId
   * @returns {Promise<void>}
   */
  savePeer: async (peerId) => {
    db.contacts.put({
      peer_id: peerId,
      fingerprint: await self.getPublicKeyFingerprint(await self.getPeerPublicKey(peerId)),
    })
      .then(() => console.log(`[LOG] Stored fingerprint of ${peerId}`))
      .catch(err => console.error(err));
  },

  /**
   * Stores the public key of a peer
   * @param peerId
   * @param key
   */
  storePeerPublicKey: async (peerId, key) => {
    db.peer_keys.put({
      peer_id: peerId,
      key_data: key,
    })
      .then(() => {
        self.savePeer(peerId);
        console.log(`[LOG] Stored public key of ${peerId}`);
      })
      .catch(err => console.error(err));
  },

  /**
   * Gets and verifies the public key of a peer
   * @param peerId
   * @returns {Dexie.Promise<Dexie.Promise<string>>}
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
        if (publicKeyPeerId !== peerId) {
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
   * Gets the unique fingerprint of the peer, generated using every data javascript can get from the
   * browser and the hashed passphrase of the peer
   * @param passphrase
   * @returns {Promise<String>}
   */
  generatePrivateFingerprint: passphrase => fingerprintJs.getPromise()
    .then((components) => {
      const fingerprintHash = fingerprintJs.x64hash128(components.map(pair => pair.value)
        .join(), 31);
      let shaObj = new JsSHA('SHA3-512', 'TEXT');
      shaObj.update(passphrase);
      const passphraseHash = shaObj.getHash('HEX');
      shaObj = new JsSHA('SHA3-512', 'TEXT');
      shaObj.update(passphraseHash);
      shaObj.update(fingerprintHash);
      return shaObj.getHash('HEX');
    }),

  /**
   * Gets the unique fingerprint of the peer, generated using every data javascript can get from the
   * browser and a randomly generated string
   * @returns {Promise<void>}
   */
  generatePublicFingerprint: () => fingerprintJs.getPromise()
    .then(async (components) => {
      const fingerprintHash = fingerprintJs.x64hash128(components.map(pair => pair.value)
        .join(), 31);
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
   * @returns {Dexie.Promise<Dexie.Promise<string>>}
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
