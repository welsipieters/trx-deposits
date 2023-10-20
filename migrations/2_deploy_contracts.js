require('dotenv').config({path: "../.env"})
const TronWeb = require("tronweb")
const DepositContract = artifacts.require("DepositContract");
const DepositAddressFactory = artifacts.require("DepositAddressFactory");

module.exports = async function(deployer, network, accounts) {
    // Deploy the DepositContract (logic contract)
    await deployer.deploy(DepositContract);
    console.log(`DepositContract (logic contract) deployed to: ${DepositContract.address}`);
    console.log(process.env);
    const coldStorageAddress = process.env.COLD_STORAGE_ADDRESS_TRON;
    if (!TronWeb.isAddress(coldStorageAddress)) {
        throw new Error(`Invalid cold storage address: ${coldStorageAddress}`);
    }

    // Deploy DepositAddressFactory with cold storage and logic contract addresses
    await deployer.deploy(DepositAddressFactory);
    console.log(`DepositAddressFactory deployed to: ${DepositAddressFactory.address}`);
    const factory = await DepositAddressFactory.deployed();
    await factory.initialize(coldStorageAddress, DepositContract.address);

    // Now, set the factory address in the DepositContract
    let instance = await DepositContract.deployed();
    await instance.initialize(DepositAddressFactory.address);
    console.log(`Set factory address in DepositContract to: ${DepositAddressFactory.address}`);
};
