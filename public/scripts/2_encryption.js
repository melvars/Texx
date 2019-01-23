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

    openpgp.generateKey(options).then((key) => {
        localStorage.setItem('private_key', key.privateKeyArmored);
        localStorage.setItem('public_key', key.publicKeyArmored);
        localStorage.setItem('revocation_certificate', key.revocationCertificate);
    });
}

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

testEncryption();
