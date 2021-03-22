const hre = require("hardhat");
const { expect } = require("chai");
const { ethers, network } = hre;

describe("🌾 Farm", function () {
  let chef, accounts, owner, multisig, ethPastaLP, maxValue, pasta, ethereum, startBlock, endBlock, pastaPerBlock, transferAmt
  before(async function () {
    accounts = await ethers.getSigners()
    owner = accounts[0]

    const multisigAddr = "0xB449dfE00aACf406eb442B22745A25430490FE1b"

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [multisigAddr]
    })

    multisig = ethers.provider.getSigner(multisigAddr)

    const pastaAbi = [
      "function balanceOf(address) view returns (uint)",
      "function transfer(address to, uint amount)",
    ]

    const uniPairAbi = [
      "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
    ]

    ethereum = network.provider

    const currentBlock = ethers.BigNumber.from(await ethereum.send('eth_blockNumber')).toNumber()

    startBlock = currentBlock + 5
    endBlock = startBlock + 100

    pastaPerBlock = ethers.utils.parseEther('5')

    const Chef = await ethers.getContractFactory("PastaChef")
    chef = await Chef.deploy(owner.address, startBlock, endBlock, pastaPerBlock)

    await chef.deployed()

    ethPastaLP = new ethers.Contract("0xE92346d9369Fe03b735Ed9bDeB6bdC2591b8227E", uniPairAbi, ethers.provider)
    pasta = new ethers.Contract("0xE54f9E6Ab80ebc28515aF8b8233c1aeE6506a15E", pastaAbi, ethers.provider)

    transferAmt = ethers.utils.parseEther('10000')

    pasta.connect(multisig).transfer(chef.address, transferAmt)

    maxValue = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  })

  it("Should verify farming info", async () => {
    const pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(0)
  })

  it("Should verify first block (zero rewards) & second block ( = pasta per block)", async () => {
    let blockNumber = ethers.BigNumber.from(await ethereum.send('eth_blockNumber')).toNumber()
    while(startBlock > blockNumber) {
      await ethereum.send("evm_mine", [])
      blockNumber = ethers.BigNumber.from(await ethereum.send('eth_blockNumber')).toNumber()
    }

    let pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(0)

    await ethereum.send("evm_mine", [])

    pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(pastaPerBlock)
  })

  it("Should claim for all", async () => {
    let balance = await pasta.balanceOf(chef.address)
    const expectedBal = transferAmt.mul(98).div(100)
    expect(balance).to.be.equal(expectedBal)

    const rewards = await chef.pendingRewards()
    const [ethRes, pastaRes, x] = await ethPastaLP.getReserves()

    await chef.claimForAll()

    balance = await pasta.balanceOf(chef.address)
    expect(balance).to.be.lt(expectedBal.sub(rewards))
    const [finalEthRes, finalPastaRes, y] = await ethPastaLP.getReserves()

    expect(finalPastaRes).to.be.gt(pastaRes)
    expect(finalEthRes).to.be.equal(ethRes)

    const pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(0)
  })

  it("Should update reward rate", async () => {
    await ethereum.send("evm_mine", [])
    await ethereum.send("evm_mine", [])

    pastaPerBlock = ethers.utils.parseEther('8')

    await chef.updateRewardRate(pastaPerBlock)

    let pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(0)

    await ethereum.send("evm_mine", [])

    pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(pastaPerBlock)
  })

  it("Should claim with updated rewards", async () => {
    const initBalance = await pasta.balanceOf(chef.address)

    const rewards = await chef.pendingRewards()
    const [ethRes, pastaRes, x] = await ethPastaLP.getReserves()

    await chef.claimForAll()

    const balance = await pasta.balanceOf(chef.address)
    expect(balance).to.be.lt(initBalance.sub(rewards))
    const [finalEthRes, finalPastaRes, y] = await ethPastaLP.getReserves()

    expect(finalPastaRes).to.be.gt(pastaRes)
    expect(finalEthRes).to.be.equal(ethRes)

    const pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(0)
  })

  it("Should update end block", async () => {
    endBlock += 1

    await chef.updateEndBlock(endBlock)

    const endBlock_ = await chef.endBlock()

    expect(endBlock_).to.be.equal(endBlock)
  })

  it("Can claim after end block", async () => {
    let blockNumber = ethers.BigNumber.from(await ethereum.send('eth_blockNumber')).toNumber()
    while(endBlock >= blockNumber) {
      await ethereum.send("evm_mine", [])
      blockNumber = ethers.BigNumber.from(await ethereum.send('eth_blockNumber')).toNumber()
    }

    await ethereum.send("evm_mine", [])

    let pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.not.equal(0)

    const initBalance = await pasta.balanceOf(chef.address)
    const [ethRes, pastaRes, x] = await ethPastaLP.getReserves()

    await chef.claimForAll()

    const balance = await pasta.balanceOf(chef.address)
    expect(balance).to.be.equal(initBalance.sub(pendingRewards))
    const [finalEthRes, finalPastaRes, y] = await ethPastaLP.getReserves()

    expect(finalPastaRes).to.be.gt(pastaRes)
    expect(finalEthRes).to.be.equal(ethRes)

    pendingRewards = await chef.pendingRewards()
    expect(pendingRewards).to.be.equal(0)
  })

  it("Cannot claim after end block", async () => {
    await expect(chef.claimForAll()).to.be.revertedWith("PastaChef::already-claimed")
  })

  it("Cannot update end block after reward period", async () => {
    await expect(chef.updateEndBlock(endBlock+100)).to.be.revertedWith("PastaChef::reward-period-over")
  })

  it("Can sweep after reward period", async () => {
    const receiverInitBal = await pasta.balanceOf(accounts[1].address)
    const initBal = await pasta.balanceOf(chef.address)
    expect(receiverInitBal).to.be.equal(0)
    await chef.sweep(accounts[1].address)
    const balance = await pasta.balanceOf(chef.address)
    expect(balance).to.be.equal(0)
    const receiverFinalBal = await pasta.balanceOf(accounts[1].address)
    expect(receiverFinalBal).to.be.equal(initBal.mul(98).div(100))
  })
})