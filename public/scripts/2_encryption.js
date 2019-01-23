const openpgp = require('openpgp');
//openpgp.initWorker({ path:'openpgp.worker.js' }); // TODO: Add openpgp web worker support

let encrypted, decrypted; // REMEMBER: Remove testing variables (leaking)

/**
 * Generates and stores encrypted private key, public key and a revocation certificate
 * @param userId
 * @param passphrase
 * @returns {Promise<void>}
 */
async function generateKeys(userId, passphrase) {
    const options = {
        userIds: [{name: userId}],
        numBits: 4096,
        passphrase: passphrase
    };

    await openpgp.generateKey(options).then((key) => {
        localStorage.setItem('private_key', key.privateKeyArmored);
        localStorage.setItem('public_key', key.publicKeyArmored);
        localStorage.setItem('revocation_certificate', key.revocationCertificate);
        console.log('[LOG] Successfully generated and stored keys!')
    });
}

/**
 * Encrypts the data with a public key (e.g the one of the person with which you're chatting)
 * @param data
 * @param publicKey
 * @returns {Promise<void>}
 */
async function encrypt(data, publicKey) {
    //const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    //await privateKeyObj.decrypt(passphrase);

    const options = {
        message: openpgp.message.fromText(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys,
        //privateKeys: [privateKeyObj] TODO: Use private key for signing
    };

    await openpgp.encrypt(options).then(ciphertext => {
        encrypted = ciphertext.data;
        console.log(encrypted);
        //return encrypted; // TODO: Return encrypted from async function
    })
}

/**
 * Decrypts encrypted data with own encrypted private key and verifies the data with the public key
 * @param data
 * @param publicKey
 * @param privateKey
 * @param passphrase
 * @returns {Promise<void>}
 */
async function decrypt(data, publicKey, privateKey, passphrase) {
    const privateKeyObj = (await openpgp.key.readArmored(privateKey)).keys[0];
    await privateKeyObj.decrypt(passphrase);

    const options = {
        message: await openpgp.message.readArmored(data),
        publicKeys: (await openpgp.key.readArmored(publicKey)).keys, // for verification
        privateKeys: [privateKeyObj]
    };

    await openpgp.decrypt(options).then(plaintext => {
        decrypted = plaintext.data;
        console.log(plaintext.data);
        //return plaintext.data
    })
}

/**
 * Checks whether the user has keys
 * @returns {boolean}
 */
function isEncrypted() {
    const hasPrivateKey = localStorage.getItem('private_key') !== null;
    const hasPublicKey = localStorage.getItem('public_key') !== null;
    const hasRevocationCertificate = localStorage.getItem('revocation_certificate') !== null;
    return (hasPrivateKey && hasPublicKey && hasRevocationCertificate);
}

/**
 * Just a general test case
 */
function testEncryption() {
    generateKeys('test_id', 'supersecure').then(() => {
        encrypt('The meaning of life', localStorage.getItem('public_key')).then(() => {
            decrypt(encrypted, localStorage.getItem('public_key'), localStorage.getItem('private_key'), 'supersecure').then(() => {
                if (decrypted === 'The meaning of life')
                    console.log("YEEHA, Test succeeded!")
            })
        })
    })
}

exports.generate = generateKeys;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.check = isEncrypted;
exports.test = testEncryption;
