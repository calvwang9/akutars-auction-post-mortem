# Akutar NFT Auction post mortem

This repo explores some of the bugs and exploits in the Akutars NFT Auction and is for educational purposes only. The code has no warranties or guarantees and should not be used in production, maliciously or otherwise.

## Context

On April 22, 2022, the [Akutars NFT project](https://twitter.com/AkuDreams) launched their NFT drop through a dutch auction where all bidders will pay the last (lowest) bid price. This type of dutch auction has been explored for NFT drops before and is considered fairer than a standard dutch auction. The project had relatively decent engagement and raised ~$34 million from their drop. However, a closer inspection of their smart contract implementation exposed a multitude of flaws including inefficient code, bugs, vulnerabilities, etc. While these issues were raised by members of their community before launch, they were dismissed by the project's team. This will explore the two major issues in their auction contract that resulted in a griefing attack as well as the permanent loss of the project's $34mil drop proceeds.

## Griefing vulnerability

This vulnerability stemmed from a poorly executed push payment model for issuing refunds to bidders who paid more than the final bid price. You can explore a copy of the Akutar auction contract in `AkuAuction.sol` and an example contract that exploits this vulnerability in `Griefer.sol`. The `Griefer.test.js` test shows how this attack would be executed.

### Explanation

The function `processRefunds()` in the auction contract looped through the list of bidders and sent their respective refunds through a call to `(bool sent, ) = bidData.bidder.call{value: refund}("");`, throwing with an error `"Failed to refund bidder"` if it doesn't succeed. The use of `call` forwards (almost) all the remaining gas in the transaction to the receiver if no gas limit is specified, and allows them to execute arbitrary code in their `receive/fallback` function. While this is a common way of sending ether to a wallet, it is dangerous to use in a push payment system as any failure or revert in one `call` will revert the entire transaction, meaning that refunds could not progress past the point of refunding the griefer and the rest of the contract flows were stuck indefinitely.

This griefing attack was executed by one of the project's community members during the live drop, albeit with non-malicious intent to [raise awareness about secure smart contract practices](https://etherscan.io/tx/0x3ded3a94e1bfa97af8ca3ab72af6ba0e2ea37a2b6f9b013bb701667181f6c2f2). The attacker left a toggle in their contract to disable the griefing and allow refunds to be processed as normal, and did so after the Akutar team acknowledged the issue.

### Fix

This vulnerability could have been mitigated in several ways, including:

- Using a pull payment system to handle refunds - although worse UX, using pull payments when handling transfers to many external addresses is a safer approach. In this model, bidders would initiate the refund transaction for their own refunds, which means no one bidder should be able to block other refunds.
- If a push payment model was to be used, the proper precautions should be in place to handle these kinds of situations. It should specify a limited amount of gas to pass in the `call`, and instead of throwing on errors, handle failed payments in a different way, e.g. wrap into WETH and transfer, or skip and handle in another process.

## Lost funds bug

After the griefing vulnerability was resolved, another bug in the contract came to light which resulted in the ~$34mil worth of funds raised by the project being stuck in the auction contract forever (https://etherscan.io/address/0xf42c318dbfbaab0eee040279c6a2588fa01a961d). The tests in `UnlockFunds.test.js` demos the bug that locks up the project funds, and also explore a potential way that the funds could be unlocked if the auction had still been active. Unfortunately since it has expired by now, this fix will not work for the Akutars team and is just a proof of concept.

### Explanation

Overall, the contract had confusing and messy data structures, which is likely what led to this bug in the first place. The `claimProjectFunds()` method to withdraw the drop proceeds was intended to require that all of the bidder refunds were completed first, which is reflected in the code:

```solidity
require(refundProgress >= totalBids, "Refunds not yet processed");
```

However even after all refunds were processed, `refundProgress` was still less than `totalBids` which blocks this function from ever being executed.

Some threads on Twitter describe this as an incrementing error and say that the `bidIndex` should be incremented by `amount` instead of `+1`, although this is not the case. While there is bad incrementing throughout the contract, in this case the `bidIndex` is intended to increment by 1 for every new unique bidder as it keeps track of bid details per address. `totalBids` (unclear naming convention here) refers to the number of NFTs that have been bid on so far, and each bidder can bid for up to 3 NFTs.

The issue is that `refundProgress` is incorrectly being compared to `totalBids` since it is related to the number of unique bidders rather than the number of NFTs, and it should instead be compared against `bidIndex`.

### Fix

Simply using `bidIndex` instead of `totalBids` would have mitigated the issue in the scope of this specific bug (ignoring all the other problems):

```solidity
require(refundProgress >= bidIndex, "Refunds not yet processed");
```

### Recovery

More interestingly though, I dug into the contract to see if there was a way to recover the lost funds. Though the contract was quite vulnerable to reentrancy and other attack vectors in multiple places, there were no opportunities to manipulate the indexes after the auction had finished, so the funds are truly lost forever. However, there did exist a way for a good actor to have been able to save the funds given that the auction was still live and they knew about the bug.

For every bid, `totalBids` would be incremented by the `amount` (of NFTs) in the bid, which was hardcoded to be less than or equal to 3.

```solidity
uint256 _totalBids = totalBids + amount;
...
totalBids = _totalBids;
```

If the bid came from a new bidder who had not bid before, `bidIndex` would be incremented by 1:

```solidity
if (myBidIndex > 0) {
    allBids[myBidIndex] = myBids;
} else {
    myBids.bidder = msg.sender;
    personalBids[msg.sender] = bidIndex;
    allBids[bidIndex] = myBids;
    bidIndex++;
}
```

If the auction ends with `bidIndex` < `totalBids`, the project funds will be locked forever. However, we can abuse the fact that the `bid` function does not check that `amount` is greater than 0 (another bug) to be able to increment `bidIndex` without increasing `totalBids`.

Since `totalBids` would be hard-capped at the total number of NFTs for auction, defined as `totalForAuction = 5495;`, we only need to ensure `bidIndex` will increment up to at least `5495`. This can be achieved by using up to `5495` unique wallets to each place a bid for a 0 amount (no funds would have to be sent since amount = 0, so this would just incur gas costs).

We can save more gas if we take into consideration that the lowest `bidIndex` possible is `5495 / 3 = 1831.66 = 1832`, which means we only need to artificially increase the `bidIndex` `5495 - 1832 = 3663` times.

```javascript
for (let i = 0; i < 3663; i++) {
  await auction.connect(wallets[i]).bid(0);
}
```
