const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("PioneChainBridge", function () {
    // Fixture để deploy contracts
    async function deployBridgeFixture() {
        const [owner, operator, user1, user2, user3] = await ethers.getSigners();

        const BSC_CHAIN_ID = 56;
        const BSC_TESTNET_ID = 97;

        // Deploy native bridge
        const minTransfer = ethers.parseEther("0.01"); // 0.01 PIO
        const maxTransfer = ethers.parseEther("500"); // 500 PIO
        const dailyLimit = ethers.parseEther("1000"); // 1000 PIO

        const Bridge = await ethers.getContractFactory("PioneChainBridge");
        const bridge = await Bridge.deploy(
            minTransfer,
            maxTransfer,
            dailyLimit,
            BSC_TESTNET_ID
        );
        await bridge.waitForDeployment();
        await bridge.unpause();

        // Setup supported chains
        const ETH_CHAIN_ID = 1;
        await bridge.setChainSupport(BSC_CHAIN_ID, true);
        await bridge.setChainSupport(ETH_CHAIN_ID, true);

        // Add initial liquidity to bridge for testing bridgeIn
        const initialLiquidity = ethers.parseEther("500");
        
        await bridge.connect(owner).bridgeOut(owner.address, BSC_CHAIN_ID, { value: initialLiquidity });
        // await bridge.addLiquidity({ value: initialLiquidity });

        return {
            bridge,
            owner,
            operator,
            user1,
            user2,
            user3,
            minTransfer,
            maxTransfer,
            dailyLimit,
            initialLiquidity,
            BSC_CHAIN_ID,
            ETH_CHAIN_ID
        };
    }

    describe("Deployment", function () {
        it("Should set the correct chain ID", async function () {
            const { bridge } = await loadFixture(deployBridgeFixture);
            const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
            expect(await bridge.CHAIN_ID()).to.equal(chainId);
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

        it("Should have initial liquidity", async function () {
            const { bridge, initialLiquidity } = await loadFixture(deployBridgeFixture);
            expect(await bridge.getTotalPIOBridgeOut()).to.equal(initialLiquidity);
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

    describe("BridgeOut (Lock Native)", function () {
        it("Should successfully lock native tokens and bridge out", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

            const balanceBefore = await ethers.provider.getBalance(user1.address);
            const bridgeBalanceBefore = await bridge.getTotalPIOBridgeOut();

            const tx = await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount });
            const receipt = await tx.wait();

            // Calculate gas cost
            const gasUsed = receipt.gasUsed * receipt.gasPrice;

            const balanceAfter = await ethers.provider.getBalance(user1.address);
            const bridgeBalanceAfter = await bridge.getTotalPIOBridgeOut();

            // User balance should decrease by amount + gas
            expect(balanceBefore - balanceAfter).to.be.greaterThan(amount);

            // Bridge balance should increase by amount
            expect(bridgeBalanceAfter - bridgeBalanceBefore).to.equal(amount);
        });

        it("Should emit BridgeInitiated event", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");
            const currentChainId = await bridge.CHAIN_ID();

            await expect(bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount }))
                .to.emit(bridge, "BridgeInitiated")
                .withArgs(
                    anyValue, // requestId
                    user1.address,
                    user1.address,
                    amount,
                    currentChainId,
                    BSC_CHAIN_ID,
                    0 // first nonce
                );
        });

        it("Should revert if amount is zero", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);

            await expect(
                bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: 0 })
            ).to.be.revertedWith("Amount must be greater than 0");
        });

        it("Should revert if amount below minimum", async function () {
            const { bridge, user1, BSC_CHAIN_ID, minTransfer } = await loadFixture(deployBridgeFixture);
            const amount = minTransfer - 1n;

            await expect(
                bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount })
            ).to.be.revertedWithCustomError(bridge, "InvalidAmount");
        });

        it("Should revert if amount above maximum", async function () {
            const { bridge, user1, BSC_CHAIN_ID, maxTransfer } = await loadFixture(deployBridgeFixture);
            const amount = maxTransfer + 1n;

            await expect(
                bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount })
            ).to.be.revertedWithCustomError(bridge, "InvalidAmount");
        });

        it("Should revert if chain not supported", async function () {
            const { bridge, user1 } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");
            const UNSUPPORTED_CHAIN = 999;

            await expect(
                bridge.connect(user1).bridgeOut(user1.address, UNSUPPORTED_CHAIN, { value: amount })
            ).to.be.revertedWith("Chain not supported");
        });

        it("Should revert with zero address recipient", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

            await expect(
                bridge.connect(user1).bridgeOut(ethers.ZeroAddress, BSC_CHAIN_ID, { value: amount })
            ).to.be.revertedWith("Invalid recipient");
        });

        it("Should enforce daily limit", async function () {
            const { bridge, user1, user2, BSC_CHAIN_ID, dailyLimit } = await loadFixture(deployBridgeFixture);

            // Transfer up to daily limit
            const halfLimit = dailyLimit / 2n;
            await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: halfLimit });

            // Should revert on next transfer
            await expect(
                bridge.connect(user2).bridgeOut(user2.address, BSC_CHAIN_ID, { value: ethers.parseEther("1") })
            ).to.be.revertedWithCustomError(bridge, "DailyLimitExceeded");
        });

        it("Should reset daily limit after 24 hours", async function () {
            const { bridge, user1, BSC_CHAIN_ID, dailyLimit } = await loadFixture(deployBridgeFixture);

            const amount = dailyLimit/2n;
            // Use full daily limit
            await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount });

            // Fast forward 1 day
            await time.increase(86400);

            // Should allow transfer again
            await expect(
                bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: ethers.parseEther("1") })
            ).to.emit(bridge, "BridgeInitiated");
        });

        it("Should revert when bridge is paused", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

            await bridge.pause();

            await expect(
                bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount })
            ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
        });

        it("Should work after unpause", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

            await bridge.pause();
            await bridge.unpause();

            await expect(
                bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount })
            ).to.emit(bridge, "BridgeInitiated");
        });

        it("Should update totalLocked correctly", async function () {
            const { bridge, user1, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

            const totalLockedBefore = await bridge.getTotalPIOBridgeOut();
            await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount });
            const totalLockedAfter = await bridge.getTotalPIOBridgeOut();

            expect(totalLockedAfter - totalLockedBefore).to.equal(amount);
        });
    });

    describe("BridgeIn (Release Native)", function () {
        it("Should successfully release native tokens to recipient", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");
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

            const balanceBefore = await ethers.provider.getBalance(user3.address);
            const bridgeBalanceBefore = await bridge.getTotalPIOBridgeOut();

            await expect(bridge.connect(owner).bridgeIn(request, requestId))
                .to.emit(bridge, "BridgeCompleted")
                .withArgs(requestId, user3.address, amount, currentChainId);

            const balanceAfter = await ethers.provider.getBalance(user3.address);
            const bridgeBalanceAfter = await bridge.getTotalPIOBridgeOut();

            expect(balanceAfter - balanceBefore).to.equal(amount);
            expect(bridgeBalanceBefore - bridgeBalanceAfter).to.equal(amount);
        });

        it("Should mark transaction as processed", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");
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
            const amount = ethers.parseEther("1");
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

        it("Should revert with invalid request ID", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");
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
            ).to.be.revertedWithCustomError(bridge, "InvalidRequest");
        });

        it("Should revert with wrong target chain", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

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
            const amount = ethers.parseEther("1");
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

        it("Should revert if insufficient liquidity", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const bridgeBalance = await bridge.getTotalPIOBridgeOut();
            const excessAmount = bridgeBalance + ethers.parseEther("1");

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
            ).to.be.revertedWith("Insufficient liquidity");
        });

        it("Should update totalLocked correctly", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");
            const currentChainId = await bridge.CHAIN_ID();

            const request = {
                from: user3.address,
                to: user3.address,
                amount: amount,
                sourceChain: BSC_CHAIN_ID,
                targetChain: currentChainId,
                nonce: 7
            };

            const requestId = ethers.keccak256(
                ethers.solidityPacked(
                    ["address", "address", "uint256", "uint256", "uint256", "uint256"],
                    [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
                )
            );

            const totalLockedBefore = await bridge.getTotalPIOBridgeOut();
            await bridge.connect(owner).bridgeIn(request, requestId);
            const totalLockedAfter = await bridge.getTotalPIOBridgeOut();

            expect(totalLockedBefore - totalLockedAfter).to.equal(amount);
        });

        it("Should revert when bridge is paused", async function () {
            const { bridge, owner, user3, BSC_CHAIN_ID } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("1");

            await bridge.pause();

            const request = {
                from: user3.address,
                to: user3.address,
                amount: amount,
                sourceChain: BSC_CHAIN_ID,
                targetChain: await bridge.CHAIN_ID(),
                nonce: 8
            };

            const requestId = ethers.keccak256(
                ethers.solidityPacked(
                    ["address", "address", "uint256", "uint256", "uint256", "uint256"],
                    [request.from, request.to, request.amount, request.sourceChain, request.targetChain, request.nonce]
                )
            );

            await expect(
                bridge.connect(owner).bridgeIn(request, requestId)
            ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
        });
    });

    describe("Admin Functions", function () {
        it("Should update transfer limits", async function () {
            const { bridge, owner } = await loadFixture(deployBridgeFixture);
            const newMin = ethers.parseEther("0.001");
            const newMax = ethers.parseEther("200");
            const newDaily = ethers.parseEther("2000");

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

        it("Should grant and revoke operator role", async function () {
            const { bridge, owner, operator } = await loadFixture(deployBridgeFixture);
            const OPERATOR_ROLE = await bridge.OPERATOR_ROLE();

            await bridge.connect(owner).grantRole(OPERATOR_ROLE, operator.address);
            expect(await bridge.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;

            await bridge.connect(owner).revokeRole(OPERATOR_ROLE, operator.address);
            expect(await bridge.hasRole(OPERATOR_ROLE, operator.address)).to.be.false;
        });
    });

    describe("View Functions", function () {
        it("Should return correct remaining daily limit", async function () {
            const { bridge, user1, BSC_CHAIN_ID, dailyLimit, initialLiquidity } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("10");

            const _afterInitLiquidity = dailyLimit - initialLiquidity;
            expect(await bridge.getRemainingDailyLimit()).to.equal(_afterInitLiquidity);

            await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount });

            expect(await bridge.getRemainingDailyLimit()).to.equal(_afterInitLiquidity - amount);
        });

        it("Should reset remaining daily limit after 24 hours", async function () {
            const { bridge, user1, BSC_CHAIN_ID, dailyLimit, initialLiquidity } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("10");

            await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount });
            
            const _afterInitLiquidity = dailyLimit - initialLiquidity;
            expect(await bridge.getRemainingDailyLimit()).to.equal(_afterInitLiquidity - amount);

            await time.increase(86400);

            expect(await bridge.getRemainingDailyLimit()).to.equal(dailyLimit);
        });

        it("Should return correct daily transferred amount", async function () {
            const { bridge, user1, BSC_CHAIN_ID, dailyLimit, initialLiquidity } = await loadFixture(deployBridgeFixture);
            const amount = ethers.parseEther("10");

            expect(await bridge.getDailyTransferred()).to.equal(initialLiquidity);

            const _afterInitLiquidity = dailyLimit - initialLiquidity;
            await bridge.connect(user1).bridgeOut(user1.address, BSC_CHAIN_ID, { value: amount });

            expect(await bridge.getDailyTransferred()).to.equal(_afterInitLiquidity + amount);
        });

        it("Should return correct contract balance", async function () {
            const { bridge, initialLiquidity } = await loadFixture(deployBridgeFixture);

            expect(await bridge.getTotalPIOBridgeOut()).to.equal(initialLiquidity);
        });
    });
});

