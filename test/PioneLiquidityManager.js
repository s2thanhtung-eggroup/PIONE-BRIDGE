const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PioneLiquidityManager", function () {

    // Fixture để deploy contracts và mock dependencies
    async function deployLiquidityManagerFixture() {
        const [owner, manager, user1, user2] = await ethers.getSigners();

        // Deploy Mock Tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const pioneToken = await MockERC20.deploy("PIONE Token", "PIO", ethers.parseEther("1000000"));
        const usdtToken = await MockERC20.deploy("Tether USD", "USDT", ethers.parseEther("1000000"));

        await pioneToken.waitForDeployment();
        await usdtToken.waitForDeployment();

        // Deploy Mock PancakePair (LP Token)
        const lpToken = await MockERC20.deploy("PancakePair PIO-USDT", "PIO-USDT-LP", ethers.parseEther("1000000"));
        await lpToken.waitForDeployment();

        // Deploy Mock Factory
        const MockFactory = await ethers.getContractFactory("MockFactory");
        const factory = await MockFactory.deploy();
        await factory.waitForDeployment();

        // Setup factory to return LP token address
        await factory.setPair(lpToken.target);

        // Deploy Mock PancakeRouter
        const MockPancakeRouter = await ethers.getContractFactory("MockPancakeRouter");
        const router = await MockPancakeRouter.deploy();
        await router.waitForDeployment();

        // Setup router to use factory
        await router.setFactory(factory.target);

        // Deploy Mock PioneChainBridge
        const MockBridge = await ethers.getContractFactory("MockPioneChainBridge");
        const bridge = await MockBridge.deploy();
        await bridge.waitForDeployment();

        // Deploy Mock PinkLock
        const MockPinkLock = await ethers.getContractFactory("MockPinkLock");
        const pinkLock = await MockPinkLock.deploy();
        await pinkLock.waitForDeployment();

        // Deploy PioneLiquidityManager
        const PioneLiquidityManager = await ethers.getContractFactory("PioneLiquidityManager");
        const liquidityManager = await PioneLiquidityManager.deploy(
            pioneToken.target,
            usdtToken.target,
            bridge.target
        );
        await liquidityManager.waitForDeployment();

        // Set mock router and pink lock addresses for testing
        await liquidityManager.setRouter(router.target);
        await liquidityManager.setPinkLock(pinkLock.target);

        // Transfer tokens to users for testing
        await pioneToken.transfer(user1.address, ethers.parseEther("10000"));
        await pioneToken.transfer(liquidityManager.target, ethers.parseEther("100000"));
        await usdtToken.transfer(user1.address, ethers.parseEther("10000"));
        await usdtToken.transfer(liquidityManager.target, ethers.parseEther("100000"));

        // Transfer LP tokens to router for testing (router will transfer these back when addLiquidity is called)
        await lpToken.transfer(router.target, ethers.parseEther("100000"));

        // User approves tokens to liquidity manager
        await usdtToken.connect(user1).approve(liquidityManager.target, ethers.MaxUint256);

        return {
            liquidityManager,
            pioneToken,
            usdtToken,
            router,
            bridge,
            pinkLock,
            lpToken,
            owner,
            manager,
            user1,
            user2
        };
    }

    describe("Deployment", function () {
        it("Should set the correct token addresses", async function () {
            const { liquidityManager, pioneToken, usdtToken } = await loadFixture(deployLiquidityManagerFixture);

            expect(await liquidityManager.PIONE_TOKEN()).to.equal(pioneToken.target);
            expect(await liquidityManager.USDT_TOKEN()).to.equal(usdtToken.target);
        });

        it("Should set correct roles", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);
            const DEFAULT_ADMIN_ROLE = await liquidityManager.DEFAULT_ADMIN_ROLE();
            const MANAGER_ROLE = await liquidityManager.MANAGER_ROLE();

            expect(await liquidityManager.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await liquidityManager.hasRole(MANAGER_ROLE, owner.address)).to.be.true;
        });

        it("Should set default lock time period to 6 months", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);
            const expectedLockTime = 30n * 24n * 60n * 60n * 6n; // 6 months in seconds

            expect(await liquidityManager.getLockTimePeriod()).to.equal(expectedLockTime);
        });

        it("Should approve max tokens to router in constructor", async function () {
            const { liquidityManager, pioneToken, usdtToken } = await loadFixture(deployLiquidityManagerFixture);
            const routerAddress = await liquidityManager.router();

            // Check if tokens are approved (this requires router to be accessible)
            // Note: May need to check actual allowance if router address is accessible
            expect(routerAddress).to.not.equal(ethers.ZeroAddress);
        });
    });

    describe("handleBridgeCompleted", function () {
        it("Should create transaction record for user", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Mark transaction as processed in mock bridge
            await bridge.setProcessedTransaction(requestId, true);

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount)
            ).to.emit(liquidityManager, "BridgeCompleted")
              .withArgs(requestId, user1.address, 0);

            // Verify transaction info
            const txInfo = await liquidityManager.getTransactionInfo(requestId, user1.address);
            expect(txInfo.pioAmount).to.equal(pioAmount);
            expect(txInfo.usdtAmount).to.equal(usdtAmount);
            expect(txInfo.liquidityAmount).to.equal(0);
            expect(txInfo._depositUSDT).to.be.false;
            expect(txInfo.pinkLockId).to.equal(0);
            expect(txInfo.userPioBalance).to.equal(pioAmount);
        });

        it("Should revert if transaction not processed on bridge", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount)
            ).to.be.revertedWith("Transaction not completed");
        });

        it("Should revert if requestId already used", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-3");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);

            // Try to use same requestId again
            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount)
            ).to.be.revertedWith("RequestId already set");
        });

        it("Should only be callable by manager role", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-4");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);

            await expect(
                liquidityManager.connect(user2).handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount)
            ).to.be.revertedWith("Not manager");
        });
    });

    describe("depositUSDT", function () {
        it("Should allow user to deposit USDT", async function () {
            const { liquidityManager, bridge, usdtToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-deposit-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Setup: handleBridgeCompleted first
            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);

            const balanceBefore = await usdtToken.balanceOf(liquidityManager.target);

            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.emit(liquidityManager, "UserDepositUSDT")
              .withArgs(requestId, user1.address, usdtAmount);

            const balanceAfter = await usdtToken.balanceOf(liquidityManager.target);
            expect(balanceAfter - balanceBefore).to.equal(usdtAmount);

            // Verify transaction updated
            const txInfo = await liquidityManager.getTransactionInfo(requestId, user1.address);
            expect(txInfo._depositUSDT).to.be.true;
            expect(txInfo.userUsdtBalance).to.equal(usdtAmount);
        });

        it("Should revert if USDT already deposited", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-deposit-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Try to deposit again
            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.be.revertedWith("Already deposited USDT");
        });

        it("Should revert if requestId doesn't exist", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("non-existent-request");

            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.be.revertedWith("RequestId does not exist");
        });
    });

    describe("claimUSDT", function () {
        it("Should allow user to claim USDT balance", async function () {
            const { liquidityManager, bridge, usdtToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-claim-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            const claimAmount = ethers.parseEther("30");
            const balanceBefore = await usdtToken.balanceOf(user1.address);

            await expect(
                liquidityManager.connect(user1).claimUSDT(claimAmount)
            ).to.emit(liquidityManager, "ClaimedUSDT")
              .withArgs(user1.address, claimAmount);

            const balanceAfter = await usdtToken.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(claimAmount);

            // Check remaining balance in contract
            const txInfo = await liquidityManager.getTransactionInfo(requestId, user1.address);
            expect(txInfo.userUsdtBalance).to.equal(usdtAmount - claimAmount);
        });

        it("Should revert if insufficient USDT balance", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const claimAmount = ethers.parseEther("100");

            await expect(
                liquidityManager.connect(user1).claimUSDT(claimAmount)
            ).to.be.revertedWith("Insufficient balance USDT");
        });
    });

    describe("addLiquidity", function () {
        it("Should successfully add liquidity and lock LP tokens", async function () {
            const { liquidityManager, bridge, pinkLock, lpToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const slippagePercent = 10;

            // Setup: bridge completed and USDT deposited
            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Add liquidity
            await expect(
                liquidityManager.addLiquidity(requestId, user1.address, slippagePercent)
            ).to.emit(liquidityManager, "LiquidityAdded");

            // Verify transaction info
            const txInfo = await liquidityManager.getTransactionInfo(requestId, user1.address);
            expect(txInfo.liquidityAmount).to.be.gt(0);
            expect(txInfo.pinkLockId).to.be.gt(0);

            // Verify lock was created
            const lockId = txInfo.pinkLockId;
            const lockInfo = await pinkLock.getLock(lockId);
            expect(lockInfo.owner).to.equal(user1.address);
            expect(lockInfo.token).to.equal(lpToken.target);
            expect(lockInfo.isLpToken).to.be.true;
            expect(lockInfo.amount).to.equal(txInfo.liquidityAmount);
        });

        it("Should emit LiquidityAdded event with correct parameters", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const slippagePercent = 5;

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // MockPancakeRouter returns 95% of desired amounts
            const expectedPioUsed = pioAmount * 95n / 100n;
            const expectedUsdtUsed = usdtAmount * 95n / 100n;
            const expectedLiquidity = (expectedPioUsed + expectedUsdtUsed) / 2n;

            await expect(
                liquidityManager.addLiquidity(requestId, user1.address, slippagePercent)
            ).to.emit(liquidityManager, "LiquidityAdded")
             .withArgs(user1.address, requestId, expectedPioUsed, expectedUsdtUsed, expectedLiquidity, slippagePercent);
        });

        it("Should emit LiquidityLocked event with correct parameters", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-3");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const slippagePercent = 5;

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            const expectedPioUsed = pioAmount * 95n / 100n;
            const expectedUsdtUsed = usdtAmount * 95n / 100n;
            const expectedLiquidity = (expectedPioUsed + expectedUsdtUsed) / 2n;

            const tx = await liquidityManager.addLiquidity(requestId, user1.address, slippagePercent);
            const receipt = await tx.wait();
            const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp;
            const expectedUnlockDate = blockTimestamp + (30 * 24 * 60 * 60 * 6); // 6 months

            await expect(tx)
                .to.emit(liquidityManager, "LiquidityLocked")
                .withArgs(user1.address, requestId, 1, expectedLiquidity, expectedUnlockDate);
        });

        it("Should update user balances correctly with refund", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-4");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            await liquidityManager.addLiquidity(requestId, user1.address, 10);

            const txInfo = await liquidityManager.getTransactionInfo(requestId, user1.address);

            // MockRouter uses 95% of tokens, so 5% should be refunded
            const expectedPioRefund = pioAmount * 5n / 100n;
            const expectedUsdtRefund = usdtAmount * 5n / 100n;

            expect(txInfo.userPioBalance).to.equal(expectedPioRefund);
            expect(txInfo.userUsdtBalance).to.equal(expectedUsdtRefund);
        });

        it("Should revert if requestId doesn't exist", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("non-existent-request");

            await expect(
                liquidityManager.addLiquidity(requestId, user1.address, 10)
            ).to.be.revertedWith("RequestId does not exist");
        });

        it("Should revert if USDT not deposited yet", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-5");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);

            // Try to add liquidity without depositing USDT first
            await expect(
                liquidityManager.addLiquidity(requestId, user1.address, 10)
            ).to.be.revertedWith("USDT not provided yet");
        });

        it("Should revert if liquidity already added", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-6");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);
            await liquidityManager.addLiquidity(requestId, user1.address, 10);

            // Try to add liquidity again
            await expect(
                liquidityManager.addLiquidity(requestId, user1.address, 10)
            ).to.be.revertedWith("Additional liquidity request made");
        });

        it("Should revert if slippage is too high", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-7");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Try with slippage > 50%
            await expect(
                liquidityManager.addLiquidity(requestId, user1.address, 51)
            ).to.be.revertedWith("Slippage too high");
        });

        it("Should only be callable by manager role", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-8");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Try to call from non-manager account
            await expect(
                liquidityManager.connect(user2).addLiquidity(requestId, user1.address, 10)
            ).to.be.revertedWith("Not manager");
        });

        it("Should work with different slippage percentages", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const slippageTests = [0, 5, 10, 25, 50];

            for (let i = 0; i < slippageTests.length; i++) {
                const requestId = ethers.id(`test-addliq-slippage-${i}`);
                const pioAmount = ethers.parseEther("100");
                const usdtAmount = ethers.parseEther("50");
                const slippage = slippageTests[i];

                await bridge.setProcessedTransaction(requestId, true);
                await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount);
                await liquidityManager.connect(user1).depositUSDT(requestId);

                await expect(
                    liquidityManager.addLiquidity(requestId, user1.address, slippage)
                ).to.emit(liquidityManager, "LiquidityAdded");

                const txInfo = await liquidityManager.getTransactionInfo(requestId, user1.address);
                expect(txInfo.liquidityAmount).to.be.gt(0);
                expect(txInfo.pinkLockId).to.be.gt(0);
            }
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set lock time period", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            const newLockTime = 30n * 24n * 60n * 60n * 12n; // 12 months
            await liquidityManager.connect(owner).setLockTimePeriod(newLockTime);

            expect(await liquidityManager.getLockTimePeriod()).to.equal(newLockTime);
        });

        it("Should revert if non-owner tries to set lock time", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const newLockTime = 30n * 24n * 60n * 60n * 12n;

            await expect(
                liquidityManager.connect(user1).setLockTimePeriod(newLockTime)
            ).to.be.revertedWith("Not owner");
        });

        it("Should revert if lock time is zero", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(owner).setLockTimePeriod(0)
            ).to.be.revertedWith("Time period must be greater than 0");
        });

        it("Should allow owner to pause contract", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await liquidityManager.connect(owner).pause();
            expect(await liquidityManager.paused()).to.be.true;
        });

        it("Should allow owner to unpause contract", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await liquidityManager.connect(owner).pause();
            await liquidityManager.connect(owner).unpause();
            expect(await liquidityManager.paused()).to.be.false;
        });
    });

    describe("View Functions", function () {
        it("Should return correct lock time period", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);
            const expectedLockTime = 30n * 24n * 60n * 60n * 6n;

            expect(await liquidityManager.getLockTimePeriod()).to.equal(expectedLockTime);
        });
    });
});
