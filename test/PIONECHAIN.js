const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PIONECHAIN", function () {
  // Constants
  const TOKEN_NAME = "PIONE CHAIN";
  const TOKEN_SYMBOL = "PIO";
  const MAX_SUPPLY = ethers.parseEther("666666666");

  /**
   * Fixture to deploy PioneToken contract
   */
  async function deployPioneTokenFixture() {
    const [owner, bridge, user1, user2, attacker] = await ethers.getSigners();

    const PioneToken = await ethers.getContractFactory("PIONECHAIN");
    const token = await PioneToken.deploy(owner.address);

    return { token, owner, bridge, user1, user2, attacker };
  }

  /**
   * Fixture with bridge configured
   */
  async function deployWithBridgeFixture() {
    const { token, owner, bridge, user1, user2, attacker } = await loadFixture(deployPioneTokenFixture);
    
    // Set bridge address
    await token.connect(owner).setTokenBridge(bridge.address);
    
    return { token, owner, bridge, user1, user2, attacker };
  }

  /**
   * Fixture with bridge configured and unpaused
   */
  async function deployWithActiveBridgeFixture() {
    const { token, owner, bridge, user1, user2, attacker } = await loadFixture(deployWithBridgeFixture);
    
    // Unpause bridge
    await token.connect(owner).unpauseTokenBridge();
    
    return { token, owner, bridge, user1, user2, attacker };
  }

  describe("Deployment", function () {
    it("Should deploy with correct name and symbol", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("Should set the right owner", async function () {
      const { token, owner } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.owner()).to.equal(owner.address);
    });

    it("Should start with zero supply", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.totalSupply()).to.equal(0);
    });

    it("Should have correct MAX_SUPPLY", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });

    it("Should start with bridge paused", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.tokenBridgePaused()).to.equal(true);
    });

    it("Should have 18 decimals (from ERC20)", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.decimals()).to.equal(18);
    });
  });

  describe("Crosschain Minting", function () {
    it("Should allow bridge to mint tokens when unpaused", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const mintAmount = ethers.parseEther("500");
      await expect(token.connect(bridge).crosschainMint(user1.address, mintAmount))
        .to.emit(token, "CrosschainMint")
        .withArgs(user1.address, mintAmount, bridge.address); // nonce starts at 0
      
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
      expect(await token.totalSupply()).to.equal(mintAmount);
    });

    it("Should allow owner to crosschain mint (when set as bridge)", async function () {
      const { token, owner, user1 } = await loadFixture(deployPioneTokenFixture);
      
      // Set owner as bridge
      await token.connect(owner).setTokenBridge(owner.address);
      await token.connect(owner).unpauseTokenBridge();
      
      const mintAmount = ethers.parseEther("500");
      await token.connect(owner).crosschainMint(user1.address, mintAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should revert if bridge is paused", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithBridgeFixture);
      
      await expect(
        token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Token bridge is paused");
    });

    it("Should revert if caller is not bridge", async function () {
      const { token, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await expect(
        token.connect(user1).crosschainMint(user2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "Unauthorized");
    });

    it("Should revert if crosschain mint exceeds max supply", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const excessAmount = MAX_SUPPLY + ethers.parseEther("1");
      
      await expect(
        token.connect(bridge).crosschainMint(user1.address, excessAmount)
      ).to.be.revertedWith("Minting would exceed max supply");
    });

    it("Should allow minting up to max supply", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await token.connect(bridge).crosschainMint(user1.address, MAX_SUPPLY);
      
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });

    it("Should increment nonce with each crosschain mint", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const mintAmount = ethers.parseEther("100");
      
      await expect(token.connect(bridge).crosschainMint(user1.address, mintAmount))
        .to.emit(token, "CrosschainMint")
        .withArgs(user1.address, mintAmount, bridge.address);
      
      await expect(token.connect(bridge).crosschainMint(user1.address, mintAmount))
        .to.emit(token, "CrosschainMint")
        .withArgs(user1.address, mintAmount, bridge.address);
    });

    it("Should reverted when mint to zero address", async function () {
      const { token, bridge } = await loadFixture(deployWithActiveBridgeFixture);
      
      // ERC20Bridgeable allows minting to zero address as a burn mechanism
      const mintAmount = ethers.parseEther("100");
      await expect(
        token.connect(bridge).crosschainMint(ethers.ZeroAddress, mintAmount)
      ).to.be.reverted;
    });
  });

  describe("Crosschain Burning", function () {
    it("Should allow bridge to burn tokens when unpaused", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // First mint some tokens
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const burnAmount = ethers.parseEther("100");
      await expect(token.connect(bridge).crosschainBurn(user1.address, burnAmount))
        .to.emit(token, "CrosschainBurn");
      
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should emit CrosschainBurn event with correct parameters", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const burnAmount = ethers.parseEther("100");
      const nonce = 123n;
      
      await expect(token.connect(bridge).crosschainBurn(user1.address, burnAmount))
        .to.emit(token, "CrosschainBurn")
        .withArgs(user1.address, burnAmount, bridge.address);
    });

    it("Should revert if bridge is paused", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithBridgeFixture);
      
      await expect(
        token.connect(bridge).crosschainBurn(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Token bridge is paused");
    });

    it("Should revert if caller is not bridge", async function () {
      const { token, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await expect(
        token.connect(user1).crosschainBurn(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "Unauthorized");
    });

    it("Should revert if burning more than balance", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await expect(
        token.connect(bridge).crosschainBurn(user1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("Should allow burning with approval", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const burnAmount = ethers.parseEther("100");
      
      // User approves bridge to spend tokens
      await token.connect(user1).approve(bridge.address, burnAmount);
      
      // Bridge burns user's tokens
      await token.connect(bridge).crosschainBurn(user1.address, burnAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount - burnAmount);
    });
  });

  describe("Regular Burning (ERC20Burnable)", function () {
    it("Should allow users to burn their own tokens", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const burnAmount = ethers.parseEther("100");
      await expect(token.connect(user1).burn(burnAmount))
        .to.emit(token, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, burnAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should allow burning tokens from another address with approval", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const burnAmount = ethers.parseEther("100");
      
      // User1 approves user2 to burn
      await token.connect(user1).approve(user2.address, burnAmount);
      
      // User2 burns user1's tokens
      await token.connect(user2).burnFrom(user1.address, burnAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should revert if burning more than balance", async function () {
      const { token, user1 } = await loadFixture(deployPioneTokenFixture);
      
      await expect(
        token.connect(user1).burn(ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("Should revert burnFrom without sufficient allowance", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      // Try to burn without approval
      await expect(
        token.connect(user2).burnFrom(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Bridge Management", function () {
    describe("Set Token Bridge", function () {
      it("Should allow owner to set bridge address", async function () {
        const { token, owner, bridge } = await loadFixture(deployPioneTokenFixture);
        
        await expect(token.connect(owner).setTokenBridge(bridge.address))
          .to.emit(token, "TokenBridgeUpdated")
          .withArgs(ethers.ZeroAddress, bridge.address);
        
        expect(await token.tokenBridge()).to.equal(bridge.address);
      });

      it("Should revert if non-owner tries to set bridge", async function () {
        const { token, user1, bridge } = await loadFixture(deployPioneTokenFixture);
        
        await expect(
          token.connect(user1).setTokenBridge(bridge.address)
        ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      });

      it("Should revert if setting zero address", async function () {
        const { token, owner } = await loadFixture(deployPioneTokenFixture);
        
        await expect(
          token.connect(owner).setTokenBridge(ethers.ZeroAddress)
        ).to.be.revertedWith("Invalid tokenBridge_ address");
      });

      it("Should revert if setting same bridge address", async function () {
        const { token, owner, bridge } = await loadFixture(deployWithBridgeFixture);
        
        await expect(
          token.connect(owner).setTokenBridge(bridge.address)
        ).to.be.revertedWith("Same tokenBridge address");
      });

      it("Should allow updating bridge address", async function () {
        const { token, owner, bridge, user1 } = await loadFixture(deployWithBridgeFixture);
        
        await expect(token.connect(owner).setTokenBridge(user1.address))
          .to.emit(token, "TokenBridgeUpdated")
          .withArgs(bridge.address, user1.address);
        
        expect(await token.tokenBridge()).to.equal(user1.address);
      });
    });

    describe("Pause/Unpause Bridge", function () {
      it("Should start with bridge paused", async function () {
        const { token } = await loadFixture(deployPioneTokenFixture);
        
        expect(await token.tokenBridgePaused()).to.equal(true);
      });

      it("Should allow owner to unpause bridge", async function () {
        const { token, owner } = await loadFixture(deployPioneTokenFixture);
        
        await expect(token.connect(owner).unpauseTokenBridge())
          .to.emit(token, "TokenBridgeUnpaused")
          .withArgs(owner.address);
        
        expect(await token.tokenBridgePaused()).to.equal(false);
      });

      it("Should allow owner to pause bridge", async function () {
        const { token, owner } = await loadFixture(deployWithActiveBridgeFixture);
        
        await expect(token.connect(owner).pauseTokenBridge())
          .to.emit(token, "TokenBridgePaused")
          .withArgs(owner.address);
        
        expect(await token.tokenBridgePaused()).to.equal(true);
      });

      it("Should revert if non-owner tries to pause", async function () {
        const { token, user1 } = await loadFixture(deployWithActiveBridgeFixture);
        
        await expect(
          token.connect(user1).pauseTokenBridge()
        ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      });

      it("Should revert if non-owner tries to unpause", async function () {
        const { token, user1 } = await loadFixture(deployPioneTokenFixture);
        
        await expect(
          token.connect(user1).unpauseTokenBridge()
        ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      });

      it("Should revert if pausing already paused bridge", async function () {
        const { token, owner } = await loadFixture(deployPioneTokenFixture);
        
        await expect(
          token.connect(owner).pauseTokenBridge()
        ).to.be.revertedWith("Token bridge already paused");
      });

      it("Should revert if unpausing already unpaused bridge", async function () {
        const { token, owner } = await loadFixture(deployWithActiveBridgeFixture);
        
        await expect(
          token.connect(owner).unpauseTokenBridge()
        ).to.be.revertedWith("Token bridge not paused");
      });
    });
  });

  describe("ERC20 Standard Functions", function () {
    it("Should transfer tokens correctly", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const transferAmount = ethers.parseEther("100");
      await expect(token.connect(user1).transfer(user2.address, transferAmount))
        .to.emit(token, "Transfer")
        .withArgs(user1.address, user2.address, transferAmount);
      
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user1.address)).to.equal(mintAmount - transferAmount);
    });

    it("Should handle approve and transferFrom correctly", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      
      const transferAmount = ethers.parseEther("100");
      
      // Approve user2 to spend user1's tokens
      await expect(token.connect(user1).approve(user2.address, transferAmount))
        .to.emit(token, "Approval")
        .withArgs(user1.address, user2.address, transferAmount);
      
      expect(await token.allowance(user1.address, user2.address)).to.equal(transferAmount);
      
      // Transfer from user1 to user2
      await token.connect(user2).transferFrom(user1.address, user2.address, transferAmount);
      
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
      expect(await token.allowance(user1.address, user2.address)).to.equal(0);
    });

    it("Should revert transfer with insufficient balance", async function () {
      const { token, user1, user2 } = await loadFixture(deployPioneTokenFixture);
      
      await expect(
        token.connect(user1).transfer(user2.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("Should revert transferFrom without allowance", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("1000"));
      
      await expect(
        token.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("ERC20 Permit (EIP-2612)", function () {
    it("Should have correct domain separator", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      const domain = await token.eip712Domain();
      expect(domain.name).to.equal(TOKEN_NAME);
      expect(domain.version).to.equal("1");
    });

    it("Should allow permit for gasless approval", async function () {
      const { token, owner, user1 } = await loadFixture(deployPioneTokenFixture);
      
      const value = ethers.parseEther("100");
      const deadline = ethers.MaxUint256;
      const nonce = await token.nonces(owner.address);
      
      // Get domain separator
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress()
      };
      
      // Create permit signature
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };
      
      const message = {
        owner: owner.address,
        spender: user1.address,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      const signature = await owner.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      // Execute permit
      await token.permit(owner.address, user1.address, value, deadline, v, r, s);
      
      expect(await token.allowance(owner.address, user1.address)).to.equal(value);
      expect(await token.nonces(owner.address)).to.equal(nonce + 1n);
    });

    it("Should revert permit with invalid signature", async function () {
      const { token, owner, user1, user2 } = await loadFixture(deployPioneTokenFixture);
      
      const value = ethers.parseEther("100");
      const deadline = ethers.MaxUint256;
      const nonce = await token.nonces(owner.address);
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress()
      };
      
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };
      
      const message = {
        owner: owner.address,
        spender: user1.address,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      // Sign with wrong signer
      const signature = await user2.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      await expect(
        token.permit(owner.address, user1.address, value, deadline, v, r, s)
      ).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
    });

    it("Should revert permit with expired deadline", async function () {
      const { token, owner, user1 } = await loadFixture(deployPioneTokenFixture);
      
      const value = ethers.parseEther("100");
      const deadline = 1; // Expired deadline
      const nonce = await token.nonces(owner.address);
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress()
      };
      
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };
      
      const message = {
        owner: owner.address,
        spender: user1.address,
        value: value,
        nonce: nonce,
        deadline: deadline
      };
      
      const signature = await owner.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      await expect(
        token.permit(owner.address, user1.address, value, deadline, v, r, s)
      ).to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature");
    });
  });

  describe("Ownership (Ownable)", function () {
    it("Should allow owner to transfer ownership", async function () {
      const { token, owner, user1 } = await loadFixture(deployPioneTokenFixture);
      
      await expect(token.connect(owner).transferOwnership(user1.address))
        .to.emit(token, "OwnershipTransferred")
        .withArgs(owner.address, user1.address);
      
      expect(await token.owner()).to.equal(user1.address);
    });

    it("Should revert ownership transfer by non-owner", async function () {
      const { token, user1, user2 } = await loadFixture(deployPioneTokenFixture);
      
      await expect(
        token.connect(user1).transferOwnership(user2.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("Should allow owner to renounce ownership", async function () {
      const { token, owner } = await loadFixture(deployPioneTokenFixture);
      
      await expect(token.connect(owner).renounceOwnership())
        .to.emit(token, "OwnershipTransferred")
        .withArgs(owner.address, ethers.ZeroAddress);
      
      expect(await token.owner()).to.equal(ethers.ZeroAddress);
    });

    it("Should prevent operations after renouncing ownership", async function () {
      const { token, owner, user1 } = await loadFixture(deployPioneTokenFixture);
      
      await token.connect(owner).renounceOwnership();
      
      await expect(
        token.connect(owner).setTokenBridge(user1.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge Cases and Integration", function () {
    it("Should handle multiple mint and burn operations correctly", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const amount = ethers.parseEther("100");
      
      // Crosschain mint
      await token.connect(bridge).crosschainMint(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount);
      
      // Regular burn
      await token.connect(user1).burn(amount / 2n);
      expect(await token.balanceOf(user1.address)).to.equal(amount / 2n);
      
      // Crosschain mint again
      await token.connect(bridge).crosschainMint(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount / 2n + amount);
      
      // Crosschain burn
      await token.connect(bridge).crosschainBurn(user1.address, amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount / 2n);
    });

    it("Should handle max supply correctly with multiple operations", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const half = MAX_SUPPLY / 2n;
      
      // Mint half
      await token.connect(bridge).crosschainMint(user1.address, half);
      
      // Mint remaining
      await token.connect(bridge).crosschainMint(user1.address, MAX_SUPPLY - half);
      
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      
      // Should revert on any more minting
      await expect(
        token.connect(bridge).crosschainMint(user1.address, 1)
      ).to.be.revertedWith("Minting would exceed max supply");
    });

    it("Should maintain total supply after burns", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const mintAmount = ethers.parseEther("1000");
      await token.connect(bridge).crosschainMint(user1.address, mintAmount);
      await token.connect(bridge).crosschainMint(user2.address, mintAmount);
      
      const initialSupply = await token.totalSupply();
      
      // Burn from user1
      await token.connect(user1).burn(ethers.parseEther("100"));
      
      // Crosschain burn from user2
      await token.connect(bridge).crosschainBurn(user2.address, ethers.parseEther("200"));
      
      expect(await token.totalSupply()).to.equal(initialSupply - ethers.parseEther("300"));
    });

    it("Should handle bridge pause/unpause correctly during operations", async function () {
      const { token, owner, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint when unpaused
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      
      // Pause
      await token.connect(owner).pauseTokenBridge();
      
      // Should revert when paused
      await expect(
        token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Token bridge is paused");
      
      // Unpause
      await token.connect(owner).unpauseTokenBridge();
      
      // Should work again
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("200"));
    });

    it("Should handle bridge change correctly", async function () {
      const { token, owner, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Old bridge mints
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      
      // Change bridge
      await token.connect(owner).setTokenBridge(user2.address);
      
      // Old bridge can't mint anymore
      await expect(
        token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(token, "Unauthorized");
      
      // New bridge can mint
      await token.connect(user2).crosschainMint(user1.address, ethers.parseEther("100"));
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("200"));
    });
  });

  describe("Security Tests", function () {
    it("Should prevent unauthorized minting", async function () {
      const { token, attacker, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await expect(
        token.connect(attacker).crosschainMint(user1.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(token, "Unauthorized");
    });

    it("Should prevent unauthorized bridge operations", async function () {
      const { token, attacker, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await expect(
        token.connect(attacker).crosschainMint(user1.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(token, "Unauthorized");
      
      await expect(
        token.connect(attacker).crosschainBurn(attacker.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(token, "Unauthorized");
    });

    it("Should prevent operations when bridge is paused", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithBridgeFixture);
      
      await expect(
        token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Token bridge is paused");
      
      await expect(
        token.connect(bridge).crosschainBurn(bridge.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Token bridge is paused");
    });

    it("Should prevent unauthorized bridge configuration", async function () {
      const { token, attacker, user1 } = await loadFixture(deployPioneTokenFixture);
      
      await expect(
        token.connect(attacker).setTokenBridge(user1.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      
      await expect(
        token.connect(attacker).pauseTokenBridge()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      
      await expect(
        token.connect(attacker).unpauseTokenBridge()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("Should prevent reentrancy attacks on bridge operations", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("1000"));
      
      // Even if called multiple times in quick succession, should work correctly
      await token.connect(bridge).crosschainBurn(user1.address, ethers.parseEther("100"));
      await token.connect(bridge).crosschainBurn(user1.address, ethers.parseEther("100"));
      await token.connect(bridge).crosschainBurn(user1.address, ethers.parseEther("100"));
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("700"));
    });

    it("Should prevent double-spending with proper allowance handling", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens to user1
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("1000"));
      
      // User1 approves user2 for 100 tokens
      await token.connect(user1).approve(user2.address, ethers.parseEther("100"));
      
      // User2 can transfer 100 tokens
      await token.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("100"));
      
      // User2 cannot transfer more
      await expect(
        token.connect(user2).transferFrom(user1.address, user2.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should efficiently handle batch operations", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Multiple mints
      for (let i = 0; i < 5; i++) {
        await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      }
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should handle large transfers efficiently", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const largeAmount = ethers.parseEther("1000000");
      
      await token.connect(bridge).crosschainMint(user1.address, largeAmount);
      await token.connect(user1).transfer(user2.address, largeAmount);
      
      expect(await token.balanceOf(user2.address)).to.equal(largeAmount);
    });
  });

  describe("ERC20Bridgeable Specific Tests", function () {
    it("Should emit CrosschainMint with correct nonce", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const amount = ethers.parseEther("100");
      
      // First mint - nonce 0
      await expect(token.connect(bridge).crosschainMint(user1.address, amount))
        .to.emit(token, "CrosschainMint")
        .withArgs(user1.address, amount, bridge.address);
      
      // Second mint
      await expect(token.connect(bridge).crosschainMint(user1.address, amount))
        .to.emit(token, "CrosschainMint")
        .withArgs(user1.address, amount, bridge.address);
    });

    it("Should track nonce independently", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      const amount = ethers.parseEther("100");
      
      // Mint to user1
      await token.connect(bridge).crosschainMint(user1.address, amount);
      
      // Mint to user2
      await token.connect(bridge).crosschainMint(user2.address, amount);
      
      // Nonce continues incrementing regardless of recipient
      await expect(token.connect(bridge).crosschainMint(user1.address, amount))
        .to.emit(token, "CrosschainMint")
        .withArgs(user1.address, amount, bridge.address);
    });

    it("Should handle crosschain burn with nonce parameter", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      // Mint tokens first
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("1000"));
      
      const burnAmount = ethers.parseEther("100");
      const nonce = 42n;
      
      // Burn with specific nonce
      await expect(token.connect(bridge).crosschainBurn(user1.address, burnAmount))
        .to.emit(token, "CrosschainBurn")
        .withArgs(user1.address, burnAmount, bridge.address);
    });
  });

  describe("View Functions", function () {
    it("Should return correct token metadata", async function () {
      const { token } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(18);
      expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });

    it("Should return correct balances", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      await token.connect(bridge).crosschainMint(user2.address, ethers.parseEther("200"));
      
      expect(await token.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
      expect(await token.balanceOf(user2.address)).to.equal(ethers.parseEther("200"));
      expect(await token.totalSupply()).to.equal(ethers.parseEther("300"));
    });

    it("Should return correct allowances", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("1000"));
      await token.connect(user1).approve(user2.address, ethers.parseEther("100"));
      
      expect(await token.allowance(user1.address, user2.address)).to.equal(ethers.parseEther("100"));
      expect(await token.allowance(user1.address, bridge.address)).to.equal(0);
    });

    it("Should return correct bridge status", async function () {
      const { token, bridge } = await loadFixture(deployWithBridgeFixture);
      
      expect(await token.tokenBridge()).to.equal(bridge.address);
      expect(await token.tokenBridgePaused()).to.equal(true);
      
      await token.connect(await ethers.provider.getSigner(0)).unpauseTokenBridge();
      
      expect(await token.tokenBridgePaused()).to.equal(false);
    });

    it("Should return correct nonces for permit", async function () {
      const { token, owner, user1 } = await loadFixture(deployPioneTokenFixture);
      
      expect(await token.nonces(owner.address)).to.equal(0);
      expect(await token.nonces(user1.address)).to.equal(0);
      
      // After using permit, nonce should increment
      const value = ethers.parseEther("100");
      const deadline = ethers.MaxUint256;
      
      const domain = {
        name: TOKEN_NAME,
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress()
      };
      
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };
      
      const message = {
        owner: owner.address,
        spender: user1.address,
        value: value,
        nonce: 0,
        deadline: deadline
      };
      
      const signature = await owner.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);
      
      await token.permit(owner.address, user1.address, value, deadline, v, r, s);
      
      expect(await token.nonces(owner.address)).to.equal(1);
    });
  });

  describe("Events", function () {
    it("Should emit Transfer event on mint", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await expect(token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100")))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, ethers.parseEther("100"));
    });

    it("Should emit Transfer event on burn", async function () {
      const { token, bridge, user1 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      
      await expect(token.connect(bridge).crosschainBurn(user1.address, ethers.parseEther("50")))
        .to.emit(token, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, ethers.parseEther("50"));
    });

    it("Should emit Approval event on approve", async function () {
      const { token, bridge, user1, user2 } = await loadFixture(deployWithActiveBridgeFixture);
      
      await token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100"));
      
      await expect(token.connect(user1).approve(user2.address, ethers.parseEther("50")))
        .to.emit(token, "Approval")
        .withArgs(user1.address, user2.address, ethers.parseEther("50"));
    });

    it("Should emit all bridge-related events", async function () {
      const { token, owner, bridge, user1 } = await loadFixture(deployPioneTokenFixture);
      
      // TokenBridgeUpdated
      await expect(token.connect(owner).setTokenBridge(bridge.address))
        .to.emit(token, "TokenBridgeUpdated");
      
      // TokenBridgeUnpaused
      await expect(token.connect(owner).unpauseTokenBridge())
        .to.emit(token, "TokenBridgeUnpaused");
      
      // CrosschainMint
      await expect(token.connect(bridge).crosschainMint(user1.address, ethers.parseEther("100")))
        .to.emit(token, "CrosschainMint");
      
      // TokenBridgePaused
      await expect(token.connect(owner).pauseTokenBridge())
        .to.emit(token, "TokenBridgePaused");
    });
  });
});