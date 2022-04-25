const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("Griefer", function () {
  let griefer;
  let auction;

  beforeEach(async function () {
    // Deploy auction contract with startingTime = current timestamp, startingPrice = 100, discountRate = 1
    const [acc1] = await ethers.getSigners();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const Auction = await ethers.getContractFactory("AkuAuction");
    auction = await Auction.deploy(acc1.address, now, 100, 1);
    await auction.deployed();

    const Griefer = await ethers.getContractFactory("Griefer");
    griefer = await Griefer.deploy();
    await griefer.deployed();
  });

  it("Griefer contract is able to bid on the auction", async function () {
    const [acc1] = await ethers.getSigners();

    await griefer.connect(acc1).bidAuction(auction.address, 1, { value: 100 });

    const bidDetails = await auction.allBids(1);
    expect(bidDetails.bidder).to.equal(griefer.address);
    expect(bidDetails.price).to.equal(100);
    expect(bidDetails.bidsPlaced).to.equal(1);
    expect(bidDetails.finalProcess).to.equal(0);
  });

  it("Griefer's bid will block the refund process", async function () {
    const [acc1, acc2, acc3] = await ethers.getSigners();

    // Place 3 bids from different bidders (second bid is griefer)
    await auction.connect(acc2).bid(1, { value: 100 });
    await griefer.connect(acc1).bidAuction(auction.address, 1, { value: 100 });
    await auction.connect(acc3).bid(1, { value: 100 });

    // Fast forward time (126 mins + 1) to end auction
    await network.provider.send("evm_increaseTime", [7620]);
    await network.provider.send("evm_mine");

    await expect(auction.processRefunds()).to.be.revertedWith(
      "Failed to refund bidder"
    );
    expect(await auction.refundProgress()).to.equal(1);
    expect(await auction.bidIndex()).to.equal(4);
  });

  it("After turning off the flag, griefer's bid no longer blocks the refund process", async function () {
    const [acc1, acc2, acc3] = await ethers.getSigners();

    // Place 3 bids from different bidders (second bid is griefer)
    await auction.connect(acc2).bid(1, { value: 100 });
    await griefer.connect(acc1).bidAuction(auction.address, 1, { value: 100 });
    await auction.connect(acc3).bid(1, { value: 100 });

    // Unblock payments to griefer
    await griefer.connect(acc1).unblock();

    // Fast forward time (126 mins + 1) to end auction
    await network.provider.send("evm_increaseTime", [7620]);
    await network.provider.send("evm_mine");

    // Refunded 21 wei to griefer with no reverts as expected
    await auction.processRefunds();
    expect(await ethers.provider.getBalance(griefer.address)).to.equal(21);
    expect(await auction.refundProgress()).to.equal(4);
    expect(await auction.bidIndex()).to.equal(4);
  });
});
