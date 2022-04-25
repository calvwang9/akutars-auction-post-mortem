const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("UnlockFunds", function () {
  let auction;
  let fixer;
  let akunft;

  beforeEach(async function () {
    // Deploy auction contract with startingTime = current timestamp, startingPrice = 100, discountRate = 1
    const [acc1] = await ethers.getSigners();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const Auction = await ethers.getContractFactory("AkuAuction");
    auction = await Auction.deploy(acc1.address, now, 100, 1);
    await auction.deployed();

    const AkuNFT = await ethers.getContractFactory("AkuNFTs");
    akunft = await AkuNFT.deploy();
    await akunft.deployed();
  });

  it("Cannot withdraw project funds from auction contract if there were bids for amount > 1", async function () {
    const [acc1, acc2, acc3] = await ethers.getSigners();

    // Place 3 bids from different bidders with an amount > 1
    await auction.connect(acc1).bid(1, { value: 100 });
    await auction.connect(acc2).bid(3, { value: 300 });
    await auction.connect(acc3).bid(2, { value: 200 });

    // Fast forward time (126 mins + 1) to end auction
    await network.provider.send("evm_increaseTime", [7620]);
    await network.provider.send("evm_mine");

    // Process refunds
    await auction.processRefunds();
    expect(await auction.refundProgress()).to.equal(4);
    expect(await auction.bidIndex()).to.equal(4);

    // Set akunft contract to be able to call claimProjectFunds()
    await auction.connect(acc1).setNFTContract(akunft.address);

    // Attempt to withdraw project funds
    expect(await auction.totalBids()).to.equal(6); // (1 + 3 + 2)
    await expect(auction.connect(acc1).claimProjectFunds()).to.be.revertedWith(
      "Refunds not yet processed"
    );
  });

  it("Can mitigate the possibility of locked funds but only during the live auction", async function () {
    const wallets = await ethers.getSigners();

    // Place 3 bids from different bidders with an amount > 1
    await auction.connect(wallets[0]).bid(3, { value: 300 });
    await auction.connect(wallets[1]).bid(3, { value: 300 });
    await auction.connect(wallets[2]).bid(2, { value: 200 });

    // totalBids = 3 + 3 + 2 = 8, whereas bidIndex = 4
    // If the auction ends with bidIndex < totalBids, project funds will be locked forever
    const bidIndex = await auction.bidIndex();
    const totalBids = await auction.totalBids();
    expect(bidIndex).to.equal(4);
    expect(totalBids).to.equal(8);

    // We can fix this by abusing the fact that the bid function does not check amount > 0
    // but still increments bidIndex for unique bidders
    for (let i = bidIndex - 1; i < totalBids - 1; i++) {
      await auction.connect(wallets[i]).bid(0);
    }
    expect(await auction.bidIndex()).to.equal(8);

    // Fast forward time (126 mins + 1) to end auction
    await network.provider.send("evm_increaseTime", [7620]);
    await network.provider.send("evm_mine");

    // Process refunds
    await auction.processRefunds();
    expect(await auction.refundProgress()).to.equal(8);

    // Set akunft contract to be able to call claimProjectFunds()
    await auction.connect(wallets[0]).setNFTContract(akunft.address);

    // Expect to successfully withdraw project funds
    await auction.connect(wallets[0]).claimProjectFunds();
    expect(await ethers.provider.getBalance(auction.address)).to.equal(0);
  });
});
