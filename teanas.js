// ===================== DISTRIBUTED TOKEN BOT (UTC VERSION) =====================
// Kode ini telah dimodifikasi untuk mendukung token TEA dengan ABI khusus,
// menangani pemanggilan fungsi decimals() (dengan default 18 untuk TEA),
// serta menampilkan jumlah token transfer dengan 2 angka desimal dan menambahkan log detail setiap token transfer.

// -------------------- Utility Function: Shuffle --------------------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// -------------------- Begin Helper Functions --------------------
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import axios from "axios";
import readlineSync from "readline-sync";
import chalk from "chalk";
import { ethers } from "ethers";
import { setTimeout as delay } from "timers/promises";

// Fungsi untuk mendapatkan timestamp dalam format UTC.
const getTimestampUTC = () => new Date().toISOString();

// Lebar log standar (dapat disesuaikan)
const LOG_WIDTH = 60;

// Fungsi logPremium: mencetak pesan dalam box dengan lebar tertentu.
function logPremium(type, msg) {
  const ts = getTimestampUTC();
  let label, color;
  switch (type.toLowerCase()) {
    case "info":
      label = "INFO";
      color = chalk.cyanBright;
      break;
    case "success":
      label = "SUCCESS";
      color = chalk.greenBright;
      break;
    case "warn":
    case "warning":
      label = "WARNING";
      color = chalk.yellowBright;
      break;
    case "error":
      label = "ERROR";
      color = chalk.redBright;
      break;
    default:
      label = type.toUpperCase();
      color = chalk.whiteBright;
  }
  const border = color("─".repeat(LOG_WIDTH));
  const coreText = ` ${ts} | ${label} | ${msg}`;
  const padded =
    coreText.length < LOG_WIDTH - 2
      ? coreText + " ".repeat(LOG_WIDTH - 2 - coreText.length)
      : coreText.slice(0, LOG_WIDTH - 2);
  const contentLine = color("│" + padded + "│");
  console.info(border);
  console.info(contentLine);
  console.info(border);
}

const logInfo = (msg) => logPremium("info", msg);
const logSuccess = (msg) => logPremium("success", msg);
const logWarn = (msg) => logPremium("warn", msg);
const logError = (msg) => logPremium("error", msg);

// -------------------- Style Symbols --------------------
const symbols = {
  rocket: chalk.magenta("🚀"),
  clock: chalk.cyan("⏰"),
  money: chalk.green("💰"),
  send: chalk.cyan("📤"),
  tx: chalk.green("🔗"),
  line: chalk.magentaBright("────────────────────────────────────────────")
};

// -------------------- RPC Provider Rotation --------------------
const rpcEndpoints = [
  process.env.RPC_URL_PRIMARY,
  process.env.RPC_URL_SECONDARY || process.env.RPC_URL_PRIMARY
].filter((ep, index, self) => ep && self.indexOf(ep) === index);

class RpcProviderRotation {
  constructor(endpoints) {
    if (endpoints.length < 1)
      throw new Error("At least one RPC endpoint is required.");
    this.endpoints = endpoints;
    this.currentIndex = 0;
    this.provider = new ethers.JsonRpcProvider(this.endpoints[this.currentIndex]);
    logInfo(`RPC Provider Initialized: ${this.getCurrentEndpoint()}`);
  }
  getCurrentEndpoint() {
    return this.endpoints[this.currentIndex];
  }
  rotate() {
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    this.provider = new ethers.JsonRpcProvider(this.endpoints[this.currentIndex]);
    logInfo(`Rotated. New RPC Provider: ${this.getCurrentEndpoint()}`);
  }
  getProvider() {
    return this.provider;
  }
}

// -------------------- Execute RPC Call dengan Error Handling --------------------
async function executeRpcCall(fn, refreshCallback, rpcInstance) {
  try {
    return await fn();
  } catch (error) {
    if (
      (error.response && error.response.status === 429) ||
      error.message.toLowerCase().includes("rate limit")
    ) {
      logError(`RPC rate limit detected at: ${rpcInstance.getCurrentEndpoint()}`);
      rpcInstance.rotate();
      if (typeof refreshCallback === "function") refreshCallback();
      logInfo("Waiting 30 seconds before retrying...");
      await delay(30000);
    }
    throw error;
  }
}

// -------------------- Execute Transfer with Gas Bump --------------------
async function executeTransferWithGasBump(tokenContract, recipient, amount, refreshCallback, rpcRotation, tokenAddress) {
  let attempt = 0;
  let bumpFactor = 1.0; // multiplier awal = 1x
  while (attempt < 5) {
    try {
      if (attempt === 0) {
        // Percobaan pertama tanpa bonus gas fee
        if (tokenAddress.toLowerCase() === "0x7eaa67f8d365bbe27d6278fdc2ba24a1aa71c8e5") {
          return await executeRpcCall(() => tokenContract.transfer(recipient, amount, { gasLimit: 100000 }), refreshCallback, rpcRotation);
        } else {
          return await executeRpcCall(() => tokenContract.transfer(recipient, amount), refreshCallback, rpcRotation);
        }
      } else {
        // Percobaan ulang dengan menaikkan gas fee
        const feeData = await tokenContract.provider.getFeeData();
        const multiplier = Math.floor(bumpFactor * 100);
        const newGasPrice = feeData.gasPrice.mul(ethers.BigNumber.from(multiplier)).div(ethers.BigNumber.from(100));
        logInfo(`Attempt ${attempt + 1}: menggunakan gas fee baru ${ethers.formatUnits(newGasPrice, "gwei")} gwei`);
        if (tokenAddress.toLowerCase() === "0x7eaa67f8d365bbe27d6278fdc2ba24a1aa71c8e5") {
          return await executeRpcCall(() => tokenContract.transfer(recipient, amount, { gasPrice: newGasPrice, gasLimit: 100000 }), refreshCallback, rpcRotation);
        } else {
          return await executeRpcCall(() => tokenContract.transfer(recipient, amount, { gasPrice: newGasPrice }), refreshCallback, rpcRotation);
        }
      }
    } catch (err) {
      if (err.message.toLowerCase().includes("replacement transaction underpriced")) {
        attempt++;
        bumpFactor *= 1.15;
        logWarn(`Replacement transaction underpriced. Meningkatkan multiplier ke ${bumpFactor.toFixed(2)} (attempt ${attempt}).`);
        await delay(2000);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Gagal mengirim transaksi setelah beberapa percobaan dengan gas fee bump.");
}

// -------------------- Format Countdown --------------------
function formatCountdown(ms) {
  let totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

// -------------------- File I/O Functions --------------------
function readAddressesFromFile(filename) {
  if (!fs.existsSync(filename)) return [];
  return fs
    .readFileSync(filename, "utf8")
    .split("\n")
    .map(line => line.trim().toLowerCase())
    .filter(Boolean);
}

function writeAddressesToFile(filename, addresses) {
  fs.writeFileSync(filename, addresses.join("\n"), "utf8");
}

// -------------------- Fetch Recipient Addresses --------------------
async function fetchRecipientAddresses() {
  const fileName = "list address.txt";
  if (!fs.existsSync(fileName)) {
    logError(`File ${fileName} tidak ditemukan. Pastikan file tersebut ada.`);
    return [];
  }
  logInfo(`Menggunakan daftar alamat dari file: ${fileName}`);
  return readAddressesFromFile(fileName);
}

// -------------------- Telegram Notification --------------------
async function sendTelegramMessage(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    logInfo("Telegram notification sent");
  } catch (err) {
    logError(`Telegram notification failed: ${err.message}`);
  }
}

// -------------------- Global Retry Function --------------------
function retry(fn, retries = 5, delayMs = 1000) {
  return new Promise((resolve, reject) => {
    fn().then(resolve).catch((error) => {
      if (retries - 1 > 0) {
        logWarn(`Failed. Retrying in ${delayMs}ms... (${retries - 1} retries left)`);
        setTimeout(() => {
          retry(fn, retries - 1, delayMs * 2).then(resolve).catch(reject);
        }, delayMs);
      } else {
        reject(error);
      }
    });
  });
}

// -------------------- Circuit Breaker --------------------
class CircuitBreaker {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.failureThreshold = options.failureThreshold || 5;
    this.coolDownTime = options.coolDownTime || 10000;
    this.successThreshold = options.successThreshold || 2;
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    logInfo(`Circuit Breaker initialized in state ${this.state}`);
  }
  async call(...args) {
    if (this.state === "OPEN")
      throw new Error("Circuit breaker is OPEN, requests are blocked temporarily.");
    try {
      const result = await this.fn(...args);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
  onSuccess() {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        logSuccess("Circuit breaker: Transitioning to CLOSED");
        this.state = "CLOSED";
        this.failureCount = 0;
      }
    }
  }
  onFailure() {
    this.failureCount++;
    logWarn(`Circuit breaker: Failure count is ${this.failureCount}`);
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      logError(`Circuit breaker: Transitioning to OPEN for ${this.coolDownTime}ms`);
      sendTelegramMessage(`⚠️ Circuit breaker OPEN after ${this.failureCount} failures.`);
      setTimeout(() => {
        this.state = "HALF_OPEN";
        this.successCount = 0;
        logInfo("Circuit breaker: Transitioning to HALF_OPEN, retrying...");
        sendTelegramMessage(`ℹ️ Circuit breaker switching to HALF_OPEN, retrying...`);
      }, this.coolDownTime);
    }
  }
}

// -------------------- INPUT DATA --------------------
const totalAccounts = parseInt(
  readlineSync.question(`[${getTimestampUTC()}] Enter the number of accounts to run: `)
);

let privateKeys = [];
logInfo("Enter each account's private key (one per line). Type 'done' when finished:");
while (true) {
  const inputKey = readlineSync.question();
  if (inputKey.trim().toLowerCase() === "done") break;
  if (inputKey.trim()) privateKeys.push(inputKey.trim());
}
if (privateKeys.length !== totalAccounts) {
  logError(`Number of private keys (${privateKeys.length}) does not match the number of accounts (${totalAccounts}).`);
  process.exit(1);
}

let contractAddresses = [];
logInfo("Enter each account's contract address (one per line). Type 'done' when finished:");
while (true) {
  const inputCtr = readlineSync.question();
  if (inputCtr.trim().toLowerCase() === "done") break;
  if (inputCtr.trim()) contractAddresses.push(inputCtr.trim());
}
if (contractAddresses.length !== totalAccounts) {
  logError(`Number of contract addresses (${contractAddresses.length}) does not match the number of accounts (${totalAccounts}).`);
  process.exit(1);
}

const globalMinToken = parseFloat(
  readlineSync.question(`[${getTimestampUTC()}] Enter the global minimum token transfer: `)
);
const globalMaxToken = parseFloat(
  readlineSync.question(`[${getTimestampUTC()}] Enter the global maximum token transfer: `)
);

const globalMinTx = parseInt(
  readlineSync.question(`[${getTimestampUTC()}] Enter the global minimum TX per day: `)
);
const globalMaxTx = parseInt(
  readlineSync.question(`[${getTimestampUTC()}] Enter the global maximum TX per day: `)
);

let delayParams = [];
for (let i = 0; i < totalAccounts; i++) {
  let minDelay = parseInt(
    readlineSync.question(`[${getTimestampUTC()}] Enter the minimum delay (seconds) for Account ${i + 1}: `)
  );
  let maxDelay = parseInt(
    readlineSync.question(`[${getTimestampUTC()}] Enter the maximum delay (seconds) for Account ${i + 1}: `)
  );
  delayParams.push({ minDelay, maxDelay });
}

const akunList = [];
for (let i = 0; i < totalAccounts; i++) {
  akunList.push({
    AKUN_TAG: `Account ${i + 1}`,
    PRIVATE_KEY: privateKeys[i],
    TOKEN_ADDRESS: contractAddresses[i],
    MIN_TOKEN: globalMinToken,
    MAX_TOKEN: globalMaxToken,
    MIN_DELAY: delayParams[i].minDelay,
    MAX_DELAY: delayParams[i].maxDelay,
    MIN_TX_PER_DAY: globalMinTx,
    MAX_TX_PER_DAY: globalMaxTx,
    rpcRotation: new RpcProviderRotation(rpcEndpoints)
  });
}
logInfo(`Total accounts entered: ${akunList.length}`);

// -------------------- Helper: Pilih ABI berdasarkan TOKEN_ADDRESS --------------------
const standardABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function decimals() view returns (uint8)"
];
const teaAbi = [
  "function transfer(address to, uint256 amount) public",
  "function decimals() view returns (uint8)"
];

// -------------------- doTransfer Function --------------------
async function doTransfer(config, tokenContract, recipients, sent, failedPrev, decimals, sentFile, pendingFile, txIndex, transferBreaker, refreshCallback, session = "") {
  // Menghasilkan nilai token transfer secara acak (float)
  const randomValue = Math.random();
  const amountToken = config.MIN_TOKEN + randomValue * (config.MAX_TOKEN - config.MIN_TOKEN);
  const formattedAmount = amountToken.toFixed(2); // format 2 angka desimal
  // Parsing ke unit token sesuai decimals kontrak
  const amount = ethers.parseUnits(formattedAmount, decimals);
  const delaySec = Math.floor(Math.random() * (config.MAX_DELAY - config.MIN_DELAY + 1)) + config.MIN_DELAY;

  console.log(`[${getTimestampUTC()}] ${symbols.send} [${config.AKUN_TAG}] TX #${txIndex} → ${chalk.gray(recipients[0].slice(0,6) + "..." + recipients[0].slice(-4))}`);
  console.log(`[${getTimestampUTC()}] ${symbols.money} Amount: ${chalk.yellowBright(formattedAmount)} TOKEN`);
  console.log(`[${getTimestampUTC()}] ${symbols.clock} Delay: ${chalk.yellow(delaySec)} seconds`);
  await delay(delaySec * 1000);

  try {
    const tx = await retry(
      () => executeTransferWithGasBump(tokenContract, recipients[0], amount, refreshCallback, config.rpcRotation, config.TOKEN_ADDRESS),
      5,
      1000
    );
    console.log(`[${getTimestampUTC()}] ${symbols.tx} TX SUCCESS | https://sepolia.tea.xyz/tx/${tx.hash}`);
    // Tambahan log untuk menampilkan detail jumlah token yang ditransfer (dengan format koma sebagai desimal)
    console.log(`[${getTimestampUTC()}] ${chalk.green("DETAIL")} Token Transfer: ${chalk.yellowBright(formattedAmount.replace(".", ","))} TOKEN`);
    sent.push(recipients.shift());
    writeAddressesToFile(sentFile, [...new Set(sent)]);
    sendTelegramMessage(`📤 *TX SUCCESS - ${config.AKUN_TAG}*\nTX #: ${txIndex}\nTo: \`${sent[sent.length-1]}\`\nAmount: \`${formattedAmount} TOKEN\`\n✔ [TX Link](https://sepolia.tea.xyz/tx/${tx.hash})`);
    return parseFloat(formattedAmount); // nilai token transfer berhasil
  } catch (err) {
    console.log(`[${getTimestampUTC()}] ${chalk.red("XX")} TX FAILED | ${err.message}`);
    failedPrev.push(recipients.shift());
    writeAddressesToFile(pendingFile, [...new Set(failedPrev)]);
    return 0; // gagal: tidak menambahkan ke total token
  }
}

// -------------------- handleAkun Function --------------------
async function handleAkun(config, day = 1) {
  logInfo(`Starting distribution for ${config.AKUN_TAG} - Day ${day}`);
  
  if (day > 1) {
    let session1Start = new Date();
    session1Start.setUTCHours(6 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 60), 0, 0);
    const now = new Date();
    const waitTime = session1Start.getTime() - now.getTime();
    if (waitTime > 0) {
      logInfo(`Waiting for Day ${day} to start (Sesi 1) in ${formatCountdown(waitTime)}`);
      await delay(waitTime);
    }
  }
  
  let provider = config.rpcRotation.getProvider();
  let wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
  
  // Pilih ABI yang sesuai berdasarkan alamat token
  const abiUsed = (config.TOKEN_ADDRESS.toLowerCase() === "0x7eaa67f8d365bbe27d6278fdc2ba24a1aa71c8e5") ? teaAbi : standardABI;
  
  let tokenContract = new ethers.Contract(
    config.TOKEN_ADDRESS,
    abiUsed,
    wallet
  );
  
  function refreshContractCallback() {
    provider = config.rpcRotation.getProvider();
    wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    tokenContract = new ethers.Contract(
      config.TOKEN_ADDRESS,
      abiUsed,
      wallet
    );
    logInfo(`Wallet and TokenContract updated to: ${config.rpcRotation.getCurrentEndpoint()}`);
  }
  
  // Tangani permasalahan decimals: jika token TEA, gunakan nilai default (misalnya 18)
  let decimals;
  if (config.TOKEN_ADDRESS.toLowerCase() === "0x7eaa67f8d365bbe27d6278fdc2ba24a1aa71c8e5") {
    decimals = 18;
    logInfo("Token TEA terdeteksi, menggunakan nilai default decimals = 18");
  } else {
    try {
      decimals = await tokenContract.decimals();
    } catch (err) {
      logError("Gagal mengambil nilai decimals: " + err.message);
      throw err;
    }
  }
  
  const transferBreaker = new CircuitBreaker(
    async (recipient, amount) => {
      const tx = await executeRpcCall(() => tokenContract.transfer(recipient, amount), refreshContractCallback, config.rpcRotation);
      await tx.wait(2);
      return tx;
    },
    { failureThreshold: 3, coolDownTime: 15000, successThreshold: 2 }
  );
  
  const recipientList = await fetchRecipientAddresses();
  const randomizedRecipients = shuffle(recipientList);
  const sentFile = `sent_${config.AKUN_TAG.replace(/\s+/g, "_")}.txt`;
  const pendingFile = `pending_${config.AKUN_TAG.replace(/\s+/g, "_")}.txt`;
  let sent   = readAddressesFromFile(sentFile);
  let failedPrev = readAddressesFromFile(pendingFile);
  let recipients = randomizedRecipients.filter(addr => !sent.includes(addr) || failedPrev.includes(addr));
  
  // Variabel untuk mengakumulasi total token yang ditransfer (berdasarkan nilai yang dikembalikan doTransfer)
  let totalTokensTransferred = 0;
  
  const txToday = Math.floor(Math.random() * (config.MAX_TX_PER_DAY - config.MIN_TX_PER_DAY + 1)) + config.MIN_TX_PER_DAY;
  logInfo(`Total TX today for ${config.AKUN_TAG}: ${txToday}`);
  
  if (day === 1) {
    logInfo(`${symbols.rocket} ${config.AKUN_TAG} - Day 1: Processing TX directly`);
    let totalSuccess = 0;
    let totalFailure = 0;
    for (let i = 0; i < txToday && recipients.length > 0; i++) {
      const amountTransferred = await doTransfer(config, tokenContract, recipients, sent, failedPrev, decimals, sentFile, pendingFile, i + 1, transferBreaker, refreshContractCallback);
      if (amountTransferred > 0) {
        totalSuccess++;
        totalTokensTransferred += amountTransferred;
      } else {
        totalFailure++;
      }
    }
    console.info(symbols.line);
    logInfo(`Daily Summary for ${config.AKUN_TAG} - Day ${day}`);
    logInfo(`Total TX: ${txToday}`);
    logInfo(`Success: ${totalSuccess}`);
    logInfo(`Failed: ${totalFailure}`);
    logInfo(`Total Token Transferred: ${Number(totalTokensTransferred).toFixed(2)} TOKEN`);
    console.info(symbols.line);
    await sendTelegramMessage(`🔗 *${config.AKUN_TAG}* finished TX on Day ${day}\nTotal TX: *${txToday}*\n✔ Success: *${totalSuccess}*\n✖ Failed: *${totalFailure}*\n💰 Total Token Transferred: *${Number(totalTokensTransferred).toFixed(2)} TOKEN*`);
  } else {
    const sessionNames = ["Morning", "Afternoon", "Evening"];
    const minTxPerSession = 40;
    if (txToday < 3 * minTxPerSession) {
      logError(`Total TX today (${txToday}) is less than the required minimum (3 x ${minTxPerSession}).`);
      return;
    }
    const available = txToday - minTxPerSession * 3;
    const r1 = Math.random(), r2 = Math.random();
    const x = Math.min(r1, r2), y = Math.max(r1, r2);
    const sessionTxList = [
      minTxPerSession + Math.floor(x * available),
      minTxPerSession + Math.floor((y - x) * available),
      txToday - (minTxPerSession + Math.floor(x * available)) - (minTxPerSession + Math.floor((y - x) * available))
    ];
    logInfo(`TX distribution per session for ${config.AKUN_TAG}: ${JSON.stringify(sessionTxList)}`);
    
    let accumulatedSuccess = 0;
    
    // ---- Sesi 1 ----
    let sesi1Success = 0, sesi1Failure = 0, sesi1Tokens = 0;
    {
      let sessionStart = new Date();
      logInfo(`${symbols.rocket} Starting ${sessionNames[0]} session for ${config.AKUN_TAG} at ${sessionStart.toISOString()}`);
      for (let i = 0; i < sessionTxList[0] && recipients.length > 0; i++) {
        const amountTransferred = await doTransfer(config, tokenContract, recipients, sent, failedPrev, decimals, sentFile, pendingFile, i + 1, transferBreaker, refreshContractCallback, sessionNames[0]);
        if (amountTransferred > 0) {
          sesi1Success++;
          sesi1Tokens += amountTransferred;
        } else {
          sesi1Failure++;
        }
      }
      accumulatedSuccess += sesi1Success;
      totalTokensTransferred += sesi1Tokens;
      const formatTime = d => `${d.getUTCHours().toString().padStart(2,"0")}:${d.getUTCMinutes().toString().padStart(2,"0")} UTC`;
      console.info(symbols.line);
      logInfo(`Session Summary for ${sessionNames[0]} - ${config.AKUN_TAG}`);
      logInfo(`Total TX: ${sessionTxList[0]}`);
      logInfo(`Success: ${sesi1Success}`);
      logInfo(`Failed: ${sesi1Failure}`);
      logInfo(`Total Tokens Transferred: ${Number(sesi1Tokens).toFixed(2)} TOKEN`);
      console.info(symbols.line);
      await sendTelegramMessage(`🚀 *${config.AKUN_TAG} Distribution*\n⏰ Session: ${sessionNames[0]}\n🔗 Total TX: ${sessionTxList[0]}\n✔ Success: ${sesi1Success}\n✖ Failed: ${sesi1Failure}\n💰 Total Tokens: ${Number(sesi1Tokens).toFixed(2)} TOKEN\n⏰ Time: \`${formatTime(sessionStart)} - ${formatTime(new Date())}\``);
    }
    
    // ---- Jeda menuju Sesi 2 ----
    {
      let sesi1Details = `Detail Sesi 1 for ${config.AKUN_TAG}:\nTotal TX: ${sessionTxList[0]}\nSuccess: ${sesi1Success}\nFailed: ${sesi1Failure}\nTotal Tokens: ${Number(sesi1Tokens).toFixed(2)} TOKEN`;
      logInfo(sesi1Details);
      await sendTelegramMessage(sesi1Details);
      
      let waitDelaySesi2 = (2 + Math.floor(Math.random() * 2)) * 60 * 60 * 1000;
      let waitTimeFormatted = formatCountdown(waitDelaySesi2);
      let delayMessage = `Jeda menuju ${sessionNames[1]} for ${config.AKUN_TAG}: ${waitTimeFormatted}`;
      logInfo(delayMessage);
      await sendTelegramMessage(delayMessage);
      await delay(waitDelaySesi2);
    }
    
    // ---- Sesi 2 ----
    let sesi2Tokens = 0;
    {
      let sessionStart = new Date();
      logInfo(`${symbols.rocket} Starting ${sessionNames[1]} session for ${config.AKUN_TAG} at ${sessionStart.toISOString()}`);
      let sesi2Success = 0, sesi2Failure = 0;
      for (let i = 0; i < sessionTxList[1] && recipients.length > 0; i++) {
        const amountTransferred = await doTransfer(config, tokenContract, recipients, sent, failedPrev, decimals, sentFile, pendingFile, i + 1, transferBreaker, refreshContractCallback, sessionNames[1]);
        if (amountTransferred > 0) {
          sesi2Success++;
          sesi2Tokens += amountTransferred;
        } else {
          sesi2Failure++;
        }
      }
      accumulatedSuccess += sesi2Success;
      totalTokensTransferred += sesi2Tokens;
      const formatTime = d => `${d.getUTCHours().toString().padStart(2,"0")}:${d.getUTCMinutes().toString().padStart(2,"0")} UTC`;
      console.info(symbols.line);
      logInfo(`Session Summary for ${sessionNames[1]} - ${config.AKUN_TAG}`);
      logInfo(`Total TX: ${sessionTxList[1]}`);
      logInfo(`Success: ${sesi2Success}`);
      logInfo(`Failed: ${sesi2Failure}`);
      logInfo(`Total Tokens Transferred: ${Number(sesi2Tokens).toFixed(2)} TOKEN`);
      console.info(symbols.line);
      await sendTelegramMessage(`🚀 *${config.AKUN_TAG} Distribution*\n⏰ Session: ${sessionNames[1]}\n🔗 Total TX: ${sessionTxList[1]}\n✔ Success: ${sesi2Success}\n✖ Failed: ${sesi2Failure}\n💰 Total Tokens: ${Number(sesi2Tokens).toFixed(2)} TOKEN\n⏰ Time: \`${formatTime(sessionStart)} - ${formatTime(new Date())}\``);
    }
    
    // ---- Jeda menuju Sesi 3 ----
    {
      let waitDelaySesi3 = (2 + Math.floor(Math.random() * 2)) * 60 * 60 * 1000;
      logInfo(`Waiting for ${sessionNames[2]} session to start in ${formatCountdown(waitDelaySesi3)}`);
      await delay(waitDelaySesi3);
      let sessionStart = new Date();
      logInfo(`${symbols.rocket} Starting ${sessionNames[2]} session for ${config.AKUN_TAG} at ${sessionStart.toISOString()}`);
      let sesi3Success = 0, sesi3Failure = 0, sesi3Tokens = 0;
      for (let i = 0; i < sessionTxList[2] && recipients.length > 0; i++) {
        const amountTransferred = await doTransfer(config, tokenContract, recipients, sent, failedPrev, decimals, sentFile, pendingFile, i + 1, transferBreaker, refreshContractCallback, sessionNames[2]);
        if (amountTransferred > 0) {
          sesi3Success++;
          sesi3Tokens += amountTransferred;
        } else {
          sesi3Failure++;
        }
      }
      accumulatedSuccess += sesi3Success;
      totalTokensTransferred += sesi3Tokens;
      const formatTime = d => `${d.getUTCHours().toString().padStart(2,"0")}:${d.getUTCMinutes().toString().padStart(2,"0")} UTC`;
      console.info(symbols.line);
      logInfo(`Session Summary for ${sessionNames[2]} - ${config.AKUN_TAG}`);
      logInfo(`Total TX: ${sessionTxList[2]}`);
      logInfo(`Success: ${sesi3Success}`);
      logInfo(`Failed: ${sesi3Failure}`);
      logInfo(`Total Tokens Transferred: ${Number(sesi3Tokens).toFixed(2)} TOKEN`);
      console.info(symbols.line);
      await sendTelegramMessage(`🚀 *${config.AKUN_TAG} Distribution*\n⏰ Session: ${sessionNames[2]}\n🔗 Total TX: ${sessionTxList[2]}\n✔ Success: ${sesi3Success}\n✖ Failed: ${sesi3Failure}\n💰 Total Tokens: ${Number(sesi3Tokens).toFixed(2)} TOKEN\n⏰ Time: \`${formatTime(sessionStart)} - ${formatTime(new Date())}\``);
    }
    
    console.info(symbols.line);
    logInfo(`Daily Summary for ${config.AKUN_TAG} - Day ${day}`);
    logInfo(`Total TX: ${txToday}`);
    logInfo(`Success: ${accumulatedSuccess}`);
    logInfo(`Failed: ${txToday - accumulatedSuccess}`);
    logInfo(`Daily Total Tokens Transferred: ${Number(totalTokensTransferred).toFixed(2)} TOKEN`);
    console.info(symbols.line);
    await sendTelegramMessage(`🔗 *${config.AKUN_TAG}* finished TX on Day ${day}\nTotal TX: *${txToday}*\n✔ Success: *${accumulatedSuccess}*\n✖ Failed: *${txToday - accumulatedSuccess}*\n💰 Daily Total Tokens Transferred: *${Number(totalTokensTransferred).toFixed(2)} TOKEN*`);
  }
  
  await sendTelegramMessage(`────────────────────────────────────────────\n🚀 *${config.AKUN_TAG}* finished Day ${day}`);
  logInfo(`Distribution for ${config.AKUN_TAG} on Day ${day} completed.`);
  return;
}

// -------------------- Execution --------------------
akunList.forEach(config => {
  (async () => {
    let day = 1;
    while (true) {
      console.info(symbols.line);
      logInfo(`Starting distribution for ${config.AKUN_TAG} on Day ${day}`);
      await handleAkun(config, day);
      logInfo(`Finished distribution for ${config.AKUN_TAG} on Day ${day}`);
      day++;
    }
  })();
});
