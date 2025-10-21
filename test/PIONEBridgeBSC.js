const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PIONEBridgeBSC", function () {
  // Fixture để deploy contracts
  async function deployBridgeFixture() {
    const [owner, operator, user1, user2, user3] = await ethers.getSigners();

    const BSC_CHAIN_ID = 56;
    const BSC_TESTNET_ID = 97;

    // Deploy PIONE token
    const PIOToken = await ethers.getContractFactory("PIONE");
    const pioToken = await PIOToken.deploy(owner.address);
    await pioToken.waitForDeployment();

    // Deploy bridge
    const minTransfer = ethers.parseEther("10");
    const maxTransfer = ethers.parseEther("100000");
    const dailyLimit = ethers.parseEther("100000");

    const Bridge = await ethers.getContractFactory("PIONEBridgeBSC");
    const bridge = await Bridge.deploy(
      await pioToken.getAddress(),
      minTransfer,
      maxTransfer,
      dailyLimit,
      BSC_TESTNET_ID
    );
    await bridge.waitForDeployment();

    // Setup: Set bridge address in token and unpause
    await pioToken.setTokenBridge(await bridge.getAddress());
    await pioToken.unpauseTokenBridge();

    // Mint tokens to users using crosschainMint (simulate previous bridge transfers)
    const tempBridge = await ethers.getContractFactory("PIONEBridgeBSC");
    const initialBridge = await tempBridge.deploy(
      await pioToken.getAddress(),
      0, 0, 0, BSC_TESTNET_ID
    );
    await initialBridge.waitForDeployment();
    
    // Temporarily set initial bridge to mint tokens
    await pioToken.setTokenBridge(await initialBridge.getAddress());
    
    // Create bridge requests to mint initial tokens
    const currentChainId = Number(await bridge.CHAIN_ID());
    

    // Mint to user1
    const request1 = {
      from: user1.address,
      to: user1.address,
      amount: ethers.parseEther("200000"),
      sourceChain: BSC_CHAIN_ID,
      targetChain: currentChainId,
      nonce: 0
    };
    const requestId1 = ethers.keccak256(
      ethers.solidityPacked(
        ["address", "address", "uint256", "uint256", "uint256", "uint256"],
        [request1.from, request1.to, request1.amount, request1.sourceChain, request1.targetChain, request1.nonce]
      )
    );
    await initialBridge.bridgeIn(request1, requestId1);

    // Mint to user2
    const request2 = {
      from: user2.address,
      to: user2.address,
      amount: ethers.parseEther("200000"),
      sourceChain: BSC_CHAIN_ID,
      targetChain: currentChainId,
      nonce: 0
    };
    const requestId2 = ethers.keccak256(
      ethers.solidityPacked(
        ["address", "address", "uint256", "uint256", "uint256", "uint256"],
        [request2.from, request2.to, request2.amount, request2.sourceChain, request2.targetChain, request2.nonce]
      )
    );
    await initialBridge.bridgeIn(request2, requestId2);
    
    // Set back to main bridge
    await pioToken.setTokenBridge(await bridge.getAddress());

    // Setup supported chains
    const ETH_CHAIN_ID = 1;
    await bridge.setChainSupport(BSC_CHAIN_ID, true);
    await bridge.setChainSupport(ETH_CHAIN_ID, true);

    return {
      bridge,
      pioToken,
      owner,
      operator,
      user1,
      user2,
      user3,
      minTransfer,
      maxTransfer,
      dailyLimit,
      BSC_CHAIN_ID,
      ETH_CHAIN_ID
    };
  }

  describe("Deployment", function () {
    it("Should set the correct token address", async function () {
      const { bridge, pioToken } = await loadFixture(deployBridgeFixture);
      expect(await bridge.pioToken()).to.equal(await pioToken.getAddress());
    });

    it("Should set correct roles", async function () {
      const { bridge, owner } = await loadFixture(deployBridgeFixture);
      const DEFAULT_ADMIN_ROLE = await bridge.DEFAULT_ADMIN_ROLE();
      const OPERATOR_ROLE = await bridge.OPERATOR_ROLE();
      
      expect(await bridge.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await bridge.hasRole(OPERATOR_ROLE, owner.address)).to.be.true;
    });

    it("Should set correct transfer limits", async function () {
      const { bridge, minTransfer, maxTransfer, dailyLimit } = await loadFixture(deployBridgeFixture);
      
      expect(await bridge.minTransferAmount()).to.equal(minTransfer);
      expect(await bridge.maxTransferAmount()).to.equal(maxTransfer);
      expect(await bridge.dailyLimit()).to.equal(dailyLimit);
    });

    it("Should revert with zero token address", async function () {
      const { owner, minTransfer, maxTransfer, dailyLimit } = await loadFixture(deployBridgeFixture);
      const Bridge = await ethers.getContractFactory("PIONEBridgeBSC");
      
      await expect(
        Bridge.deploy(ethers.ZeroAddress, minTransfer, maxTransfer, dailyLimit, 97)
      ).to.be.revertedWith("Invalid token address");
    });

    it("Should verify token bridge is set correctly", async function () {
      const { bridge, pioToken } = await loadFixture(deployBridgeFixture);
      expect(await pioToken.tokenBridge()).to.equal(await bridge.getAddress());
    });

    it("Should verify token bridge is unpaused", async function () {
      const { pioToken } = await loadFixture(deployBridgeFixture);
      expect(await pioToken.tokenBridgePaused()).to.be.false;
    });
  });

  describe("Chain Support", function () {
    it("Should add supported chain", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      const POLYGON_CHAIN = 137;
      
      await expect(bridge.setChainSupport(POLYGON_CHAIN, true))
        .to.emit(bridge, "ChainSupportUpdated")
        .withArgs(POLYGON_CHAIN, true);
      
      expect(await bridge.supportedChains(POLYGON_CHAIN)).to.be.true;
    });

    it("Should remove supported chain", async function () {
      const { bridge, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      
      await bridge.setChainSupport(BSC_CHAIN_ID, false);
      expect(await bridge.supportedChains(BSC_CHAIN_ID)).to.be.false;
    });

    it("Should not allow modifying current chain", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      const currentChainId = await bridge.CHAIN_ID();
      
      await expect(
        bridge.setChainSupport(currentChainId, false)
      ).to.be.revertedWith("Cannot modify current chain");
    });

    it("Should only allow admin to manage chains", async function () {
      const { bridge, user1 } = await loadFixture(deployBridgeFixture);
      
      await expect(
        bridge.connect(user1).setChainSupport(137, true)
      ).to.be.reverted;
    });
  });

  describe("BridgeOut (Burn)", function () {
    it("Should successfully bridge out tokens", async function () {
      const { bridge, pioToken, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      const balanceBefore = await pioToken.balanceOf(user1.address);
      
      await expect(bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID))
        .to.emit(bridge, "BridgeInitiated");
      
      const balanceAfter = await pioToken.balanceOf(user1.address);
      expect(balanceBefore - balanceAfter).to.equal(amount);
    });

    it("Should increment user nonce", async function () {
      const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      await bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID);
      await bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID);
      
      const filter = bridge.filters.BridgeInitiated();
      const events = await bridge.queryFilter(filter);
      
      // Get only user1's events (last 2)
      const user1Events = events.filter(e => e.args.from.toLowerCase() === user1.address.toLowerCase());
      expect(user1Events.length).to.be.greaterThanOrEqual(2);
      
      // Check the last two events have incrementing nonces
      const lastTwo = user1Events.slice(-2);
      expect(lastTwo[1].args.nonce).to.equal(lastTwo[0].args.nonce + 1n);
    });

    it("Should revert if amount below minimum", async function () {
      const { bridge, user1, BSC_CHAIN_ID, minTransfer } = await loadFixture(deployBridgeFixture);
      const amount = minTransfer - 1n;
      
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID)
      ).to.be.revertedWithCustomError(bridge, "InvalidAmount");
    });

    it("Should revert if amount above maximum", async function () {
      const { bridge, user1, BSC_CHAIN_ID, maxTransfer } = await loadFixture(deployBridgeFixture);
      const amount = maxTransfer + 1n;
      
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID)
      ).to.be.revertedWithCustomError(bridge, "InvalidAmount");
    });

    it("Should revert if chain not supported", async function () {
      const { bridge, user1 } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      const UNSUPPORTED_CHAIN = 999;
      
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, amount, UNSUPPORTED_CHAIN)
      ).to.be.revertedWith("Chain not supported");
    });

    it("Should revert with zero address recipient", async function () {
      const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      await expect(
        bridge.connect(user1).bridgeOut(ethers.ZeroAddress, amount, BSC_CHAIN_ID)
      ).to.be.revertedWith("Invalid recipient");
    });

    it("Should enforce daily limit", async function () {
      const { pioToken ,bridge, user1, user2, BSC_CHAIN_ID, dailyLimit } = await loadFixture(deployBridgeFixture);
      
      // Transfer up to daily limit
      const halfLimit = dailyLimit / 2n;

      const balance = await pioToken.balanceOf(user1.address)
      console.log('halfLimit :>> ', ethers.formatEther(halfLimit));
      console.log('balanceBefore :>> ', ethers.formatEther(balance));

      await bridge.connect(user1).bridgeOut(user1.address, halfLimit, BSC_CHAIN_ID);
      const balance1 = await pioToken.balanceOf(user1.address)
      console.log('balance 1 :>> ', ethers.formatEther(balance1));

      await bridge.connect(user1).bridgeOut(user1.address, halfLimit, BSC_CHAIN_ID);
      const balance2 = await pioToken.balanceOf(user1.address)
      console.log('balance 2 :>> ', ethers.formatEther(balance2));
      
      // Should revert on next transfer
      await expect(
        bridge.connect(user2).bridgeOut(user2.address, ethers.parseEther("100"), BSC_CHAIN_ID)
      ).to.be.revertedWithCustomError(bridge, "DailyLimitExceeded");
    });

    it("Should reset daily limit after 24 hours", async function () {
      const { bridge, user1, BSC_CHAIN_ID, dailyLimit } = await loadFixture(deployBridgeFixture);
      
      // Use full daily limit
      await bridge.connect(user1).bridgeOut(user1.address, dailyLimit, BSC_CHAIN_ID);
      
      // Fast forward 1 day
      await time.increase(86400);
      
      // Should allow transfer again
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, ethers.parseEther("100"), BSC_CHAIN_ID)
      ).to.emit(bridge, "BridgeInitiated");
    });

    it("Should revert when bridge is paused", async function () {
      const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      await bridge.pause();
      
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID)
      ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
    });

    it("Should work after unpause", async function () {
      const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      await bridge.pause();
      await bridge.unpause();
      
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID)
      ).to.emit(bridge, "BridgeInitiated");
    });

    it("Should revert if token bridge is paused in token contract", async function () {
      const { bridge, pioToken, user1, BSC_CHAIN_ID, owner } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      // Pause token bridge
      await pioToken.connect(owner).pauseTokenBridge();
      
      await expect(
        bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID)
      ).to.be.revertedWith("Token bridge is paused");
    });
  });

  describe("BridgeIn (Mint)", function () {
    it("Should successfully bridge in tokens", async function () {
      const { bridge, pioToken, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      const currentChainId = await bridge.CHAIN_ID();
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: currentChainId,
        nonce: 0
      };
      
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      const balanceBefore = await pioToken.balanceOf(user3.address);
      
      await expect(bridge.connect(owner).bridgeIn(request, requestId))
        .to.emit(bridge, "BridgeCompleted")
        .withArgs(requestId, user3.address, amount, currentChainId);
      
      const balanceAfter = await pioToken.balanceOf(user3.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });

    it("Should mark transaction as processed", async function () {
      const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      const currentChainId = await bridge.CHAIN_ID();
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: currentChainId,
        nonce: 1
      };
      
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      await bridge.connect(owner).bridgeIn(request, requestId);
      
      expect(await bridge.processedTransactions(requestId)).to.be.true;
    });

    it("Should prevent double processing", async function () {
      const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      const currentChainId = await bridge.CHAIN_ID();
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: currentChainId,
        nonce: 2
      };
      
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      await bridge.connect(owner).bridgeIn(request, requestId);
      
      await expect(
        bridge.connect(owner).bridgeIn(request, requestId)
      ).to.be.revertedWith("Already processed");
    });

    it("Should revert with InvalidRequest ID", async function () {
      const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      const currentChainId = await bridge.CHAIN_ID();
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: currentChainId,
        nonce: 3
      };
      
      const fakeRequestId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      
      await expect(
        bridge.connect(owner).bridgeIn(request, fakeRequestId)
      ).to.be.reverted;
    });

    it("Should revert with wrong target chain", async function () {
      const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: 999,
        nonce: 4
      };
      
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      await expect(
        bridge.connect(owner).bridgeIn(request, requestId)
      ).to.be.revertedWith("Wrong target chain");
    });

    it("Should only allow operator role", async function () {
      const { bridge, user1, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      const currentChainId = await bridge.CHAIN_ID();
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: currentChainId,
        nonce: 5
      };
      
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      await expect(
        bridge.connect(user1).bridgeIn(request, requestId)
      ).to.be.reverted;
    });

    it("Should respect MAX_SUPPLY cap", async function () {
      const { bridge, pioToken, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      
      const MAX_SUPPLY = await pioToken.MAX_SUPPLY();
      const currentSupply = await pioToken.totalSupply();
      const remaining = MAX_SUPPLY - currentSupply;
      
      // Try to mint more than remaining supply
      const excessAmount = remaining + ethers.parseEther("1");
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: excessAmount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: await bridge.CHAIN_ID(),
        nonce: 6
      };
  
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      await expect(
        bridge.connect(owner).bridgeIn(request, requestId)
      ).to.be.revertedWith("Minting would exceed max supply");
    });

    it("Should revert if token bridge is paused", async function () {
      const { bridge, pioToken, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      // Pause token bridge
      await pioToken.connect(owner).pauseTokenBridge();
      
      const request = {
        from: user3.address,
        to: user3.address,
        amount: amount,
        sourceChain: BSC_CHAIN_ID,
        targetChain: await bridge.CHAIN_ID(),
        nonce: 7
      };
      
      const requestId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "uint256", "uint256", "uint256", "uint256"],
          [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
        )
      );
      
      await expect(
        bridge.connect(owner).bridgeIn(request, requestId)
      ).to.be.revertedWith("Token bridge is paused");
    });
  });

  describe("Admin Functions", function () {
    it("Should update transfer limits", async function () {
      const { bridge, owner } = await loadFixture(deployBridgeFixture);
      const newMin = ethers.parseEther("5");
      const newMax = ethers.parseEther("20000");
      const newDaily = ethers.parseEther("200000");
      
      await expect(bridge.connect(owner).setTransferLimits(newMin, newMax, newDaily))
        .to.emit(bridge, "TransferLimitsUpdated")
        .withArgs(newMin, newMax, newDaily);
      
      expect(await bridge.minTransferAmount()).to.equal(newMin);
      expect(await bridge.maxTransferAmount()).to.equal(newMax);
      expect(await bridge.dailyLimit()).to.equal(newDaily);
    });

    it("Should pause and unpause bridge", async function () {
      const { bridge, owner } = await loadFixture(deployBridgeFixture);
      
      await bridge.connect(owner).pause();
      expect(await bridge.paused()).to.be.true;
      
      await bridge.connect(owner).unpause();
      expect(await bridge.paused()).to.be.false;
    });

    it("Should only allow admin to pause", async function () {
      const { bridge, user1 } = await loadFixture(deployBridgeFixture);
      
      await expect(bridge.connect(user1).pause()).to.be.reverted;
    });

    it("Should only allow admin to update limits", async function () {
      const { bridge, user1 } = await loadFixture(deployBridgeFixture);
      
      await expect(
        bridge.connect(user1).setTransferLimits(0, 0, 0)
      ).to.be.reverted;
    });
  });

  describe("Token Bridge Management", function () {
    it("Should allow owner to pause token bridge", async function () {
      const { pioToken, owner } = await loadFixture(deployBridgeFixture);
      
      await expect(pioToken.connect(owner).pauseTokenBridge())
        .to.emit(pioToken, "TokenBridgePaused")
        .withArgs(owner.address);
      
      expect(await pioToken.tokenBridgePaused()).to.be.true;
    });

    it("Should allow owner to unpause token bridge", async function () {
      const { pioToken, owner } = await loadFixture(deployBridgeFixture);
      
      await pioToken.connect(owner).pauseTokenBridge();
      
      await expect(pioToken.connect(owner).unpauseTokenBridge())
        .to.emit(pioToken, "TokenBridgeUnpaused")
        .withArgs(owner.address);
      
      expect(await pioToken.tokenBridgePaused()).to.be.false;
    });

    it("Should allow owner to update token bridge address", async function () {
      const { pioToken, bridge, owner, user1 } = await loadFixture(deployBridgeFixture);
      const oldBridge = await bridge.getAddress();
      
      await expect(pioToken.connect(owner).setTokenBridge(user1.address))
        .to.emit(pioToken, "TokenBridgeUpdated")
        .withArgs(oldBridge, user1.address);
      
      expect(await pioToken.tokenBridge()).to.equal(user1.address);
    });

    it("Should not allow non-owner to manage token bridge", async function () {
      const { pioToken, user1 } = await loadFixture(deployBridgeFixture);
      
      await expect(
        pioToken.connect(user1).pauseTokenBridge()
      ).to.be.reverted;
      
      await expect(
        pioToken.connect(user1).setTokenBridge(user1.address)
      ).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    it("Should return correct remaining daily limit", async function () {
      const { bridge, user1, BSC_CHAIN_ID, dailyLimit } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("1000");
      
      expect(await bridge.getRemainingDailyLimit()).to.equal(dailyLimit);
      
      await bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID);
      
      expect(await bridge.getRemainingDailyLimit()).to.equal(dailyLimit - amount);
    });

    it("Should reset remaining daily limit after 24 hours", async function () {
      const { bridge, user1, BSC_CHAIN_ID, dailyLimit } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("1000");
      
      await bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID);
      
      expect(await bridge.getRemainingDailyLimit()).to.equal(dailyLimit - amount);
      
      await time.increase(86400);
      
      expect(await bridge.getRemainingDailyLimit()).to.equal(dailyLimit);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple users bridging simultaneously", async function () {
      const { bridge, user1, user2, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
      const amount = ethers.parseEther("100");
      
      await Promise.all([
        bridge.connect(user1).bridgeOut(user1.address, amount, BSC_CHAIN_ID),
        bridge.connect(user2).bridgeOut(user2.address, amount, BSC_CHAIN_ID)
      ]);
      
      const filter = bridge.filters.BridgeInitiated();
      const events = await bridge.queryFilter(filter);
      
      expect(events.length).to.be.greaterThanOrEqual(2);
    });

    // it("Should handle zero daily limit (unlimited)", async function () {
    //   const { bridge, user1, BSC_CHAIN_ID, owner } = await loadFixture(deployBridgeFixture);
      
    //   await bridge.connect(owner).setTransferLimits(
    //     ethers.parseEther("10"),
    //     ethers.parseEther("50000"),
    //     0
    //   );
      
    //   const largeAmount = ethers.parseEther("50000");
      
    //   await expect(
    //     bridge.connect

    });
})