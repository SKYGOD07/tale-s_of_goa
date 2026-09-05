const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("FaceVerification Smart Contract", function () {
  let faceVerification;
  let owner;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const FaceVerificationFactory = await ethers.getContractFactory("FaceVerification");
    faceVerification = await FaceVerificationFactory.deploy();
  });

  it("Should record a biometric verification hash and emit VerificationRecorded event", async function () {
    const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("sample_biometric_record"));

    // The emitted timestamp is block.timestamp of the mining block, which
    // cannot be predicted from the latest block without racing the node clock.
    // Match it loosely here and pin it against the receipt's block below.
    const tx = await faceVerification.recordVerification(sampleHash);
    await expect(tx)
      .to.emit(faceVerification, "VerificationRecorded")
      .withArgs(sampleHash, anyValue, owner.address);

    const receipt = await tx.wait();
    const minedBlock = await ethers.provider.getBlock(receipt.blockNumber);

    const record = await faceVerification.getVerification(sampleHash);
    expect(record.recorder).to.equal(owner.address);
    expect(record.timestamp).to.equal(minedBlock.timestamp);
  });

  it("Should reject zero bytes32 hash", async function () {
    const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
    await expect(faceVerification.recordVerification(zeroHash)).to.be.revertedWith("Invalid record hash");
  });

  it("Should revert when querying a hash that was never recorded", async function () {
    const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("never_recorded"));
    await expect(faceVerification.getVerification(unknownHash)).to.be.revertedWith("Record hash not found");
  });
});
