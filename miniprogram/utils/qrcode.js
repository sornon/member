/*
 * Minimal QRCode generator for WeChat Mini Program canvas.
 * Adapted from qrcode-generator (MIT License).
 */

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | 1;
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function getBCHDigit(data) {
  let digit = 0;
  while (data !== 0) {
    digit += 1;
    data >>>= 1;
  }
  return digit;
}

function getBCHTypeInfo(data) {
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
    d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

function getErrorCorrectPolynomial(errorCorrectLength) {
  let poly = new Polynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i += 1) {
    poly = poly.multiply(new Polynomial([1, QRMath.gexp(i)], 0));
  }
  return poly;
}

class Polynomial {
  constructor(num, shift) {
    if (!Array.isArray(num)) {
      throw new Error('num is not array');
    }
    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset += 1;
    }
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      this.num[i] = num[i + offset];
    }
  }

  get(index) {
    return this.num[index];
  }

  getLength() {
    return this.num.length;
  }

  multiply(e) {
    const num = new Array(this.getLength() + e.getLength() - 1);
    for (let i = 0; i < this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num[i + j] = (num[i + j] || 0) ^ QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
      }
    }
    return new Polynomial(num, 0);
  }

  mod(e) {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }
    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i += 1) {
      num[i] = this.get(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    }
    return new Polynomial(num, 0).mod(e);
  }
}

const QRMath = {
  EXP_TABLE: new Array(256),
  LOG_TABLE: new Array(256),
  glog(n) {
    if (n < 1) {
      throw new Error(`glog(${n})`);
    }
    return QRMath.LOG_TABLE[n];
  },
  gexp(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return QRMath.EXP_TABLE[n];
  }
};

for (let i = 0; i < 8; i += 1) {
  QRMath.EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i += 1) {
  QRMath.EXP_TABLE[i] =
    QRMath.EXP_TABLE[i - 4] ^
    QRMath.EXP_TABLE[i - 5] ^
    QRMath.EXP_TABLE[i - 6] ^
    QRMath.EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i += 1) {
  QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
}

const VERSION_DATA = [
  {
    typeNumber: 1,
    alignmentPatternCenters: [],
    rsBlocks: [{ totalCount: 26, dataCount: 16 }]
  },
  {
    typeNumber: 2,
    alignmentPatternCenters: [6, 18],
    rsBlocks: [{ totalCount: 44, dataCount: 28 }]
  },
  {
    typeNumber: 3,
    alignmentPatternCenters: [6, 22],
    rsBlocks: [{ totalCount: 70, dataCount: 44 }]
  },
  {
    typeNumber: 4,
    alignmentPatternCenters: [6, 26],
    rsBlocks: [
      { totalCount: 50, dataCount: 32 },
      { totalCount: 50, dataCount: 32 }
    ]
  }
];

const ERROR_CORRECTION_LEVEL = 0; // Level M

function getVersionInfo(typeNumber) {
  return VERSION_DATA.find((info) => info.typeNumber === typeNumber) || null;
}

function chooseTypeNumber(text) {
  for (let i = 0; i < VERSION_DATA.length; i += 1) {
    const version = VERSION_DATA[i];
    const totalDataCount = version.rsBlocks.reduce((sum, block) => sum + block.dataCount, 0);
    const charCountBits = version.typeNumber < 10 ? 8 : 16;
    const maxBits = totalDataCount * 8 - 4 - charCountBits;
    if (text.length * 8 <= maxBits) {
      return version.typeNumber;
    }
  }
  throw new Error('text too long');
}

function getRSBlocks(typeNumber) {
  const version = getVersionInfo(typeNumber);
  if (!version) {
    throw new Error(`invalid typeNumber: ${typeNumber}`);
  }
  return version.rsBlocks.map((block) => ({ ...block }));
}

function createBytes(buffer, rsBlocks) {
  const maxDc = rsBlocks.reduce((max, block) => Math.max(max, block.dataCount), 0);
  const maxEc = rsBlocks.reduce((max, block) => Math.max(max, block.totalCount - block.dataCount), 0);
  const dcdata = new Array(rsBlocks.length);
  const ecdata = new Array(rsBlocks.length);
  let index = 0;
  for (let r = 0; r < rsBlocks.length; r += 1) {
    const dcCount = rsBlocks[r].dataCount;
    const ecCount = rsBlocks[r].totalCount - dcCount;
    const dcRow = new Array(dcCount);
    for (let i = 0; i < dcCount; i += 1) {
      dcRow[i] = buffer[index] & 0xff;
      index += 1;
    }
    dcdata[r] = dcRow;
    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new Polynomial(dcRow, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    const ecRow = new Array(ecCount);
    for (let i = 0; i < ecCount; i += 1) {
      const modIndex = i + modPoly.getLength() - ecCount;
      ecRow[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
    ecdata[r] = ecRow;
  }
  const totalCodeCount = rsBlocks.reduce((sum, block) => sum + block.totalCount, 0);
  const data = new Array(totalCodeCount);
  let dataIndex = 0;
  for (let i = 0; i < maxDc; i += 1) {
    for (let r = 0; r < rsBlocks.length; r += 1) {
      if (i < dcdata[r].length) {
        data[dataIndex] = dcdata[r][i];
        dataIndex += 1;
      }
    }
  }
  for (let i = 0; i < maxEc; i += 1) {
    for (let r = 0; r < rsBlocks.length; r += 1) {
      if (i < ecdata[r].length) {
        data[dataIndex] = ecdata[r][i];
        dataIndex += 1;
      }
    }
  }
  return data;
}

function createDataBuffer(text, typeNumber) {
  const rsBlocks = getRSBlocks(typeNumber);
  const totalDataCount = rsBlocks.reduce((sum, block) => sum + block.dataCount, 0);
  const totalDataBits = totalDataCount * 8;
  const charCountBits = typeNumber < 10 ? 8 : 16;
  const bitBuffer = [];

  function appendBits(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) {
      bitBuffer.push((value >>> i) & 1);
    }
  }

  appendBits(0b0100, 4);
  appendBits(text.length, charCountBits);
  for (let i = 0; i < text.length; i += 1) {
    appendBits(text.charCodeAt(i), 8);
  }

  let remainingBits = totalDataBits - bitBuffer.length;
  if (remainingBits < 0) {
    throw new Error('text too long');
  }

  const terminator = Math.min(4, remainingBits);
  appendBits(0, terminator);

  while (bitBuffer.length % 8 !== 0) {
    bitBuffer.push(0);
  }

  const paddingBytes = [0xec, 0x11];
  let padIndex = 0;
  while (bitBuffer.length < totalDataBits) {
    appendBits(paddingBytes[padIndex % paddingBytes.length], 8);
    padIndex += 1;
  }

  const buffer = [];
  for (let i = 0; i < bitBuffer.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) {
      byte = (byte << 1) | bitBuffer[i + j];
    }
    buffer.push(byte);
  }
  return buffer;
}

function initializeModules(typeNumber) {
  const moduleCount = typeNumber * 4 + 17;
  const modules = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null));
  const reserved = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(false));

  setupPositionProbePattern(modules, reserved, 0, 0);
  setupPositionProbePattern(modules, reserved, moduleCount - 7, 0);
  setupPositionProbePattern(modules, reserved, 0, moduleCount - 7);

  setupTimingPattern(modules, reserved);
  setupPositionAdjustPattern(modules, reserved, typeNumber);
  reserveTypeInfo(modules, reserved);

  modules[moduleCount - 8][8] = true;
  reserved[moduleCount - 8][8] = true;

  return { modules, reserved };
}

function setupPositionProbePattern(modules, reserved, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    if (row + r < 0 || row + r >= modules.length) continue;
    for (let c = -1; c <= 7; c += 1) {
      if (col + c < 0 || col + c >= modules.length) continue;
      let value;
      if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))) {
        value = true;
      } else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
        value = true;
      } else {
        value = false;
      }
      modules[row + r][col + c] = value;
      reserved[row + r][col + c] = true;
    }
  }
}
function setupTimingPattern(modules, reserved) {
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[i][6]) {
      modules[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
    if (!reserved[6][i]) {
      modules[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
  }
}

function setupPositionAdjustPattern(modules, reserved, typeNumber) {
  const version = getVersionInfo(typeNumber);
  if (!version || !version.alignmentPatternCenters.length) {
    return;
  }
  const positions = version.alignmentPatternCenters;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const row = positions[i];
      const col = positions[j];
      if (reserved[row][col]) {
        continue;
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const rr = row + r;
          const cc = col + c;
          if (rr < 0 || rr >= modules.length || cc < 0 || cc >= modules.length) {
            continue;
          }
          const max = Math.max(Math.abs(r), Math.abs(c));
          modules[rr][cc] = max === 0 || max === 2;
          reserved[rr][cc] = true;
        }
      }
    }
  }
}

function reserveTypeInfo(modules, reserved) {
  const size = modules.length;
  for (let i = 0; i < 9; i += 1) {
    reserved[i][8] = true;
    reserved[8][i] = true;
  }
  for (let i = size - 8; i < size; i += 1) {
    reserved[i][8] = true;
    reserved[8][i] = true;
  }
  reserved[8][size - 8] = true;
}

function setupTypeInfo(modules, maskPattern) {
  const bits = calculateTypeInfo(maskPattern);
  const size = modules.length;
  for (let i = 0; i < 15; i += 1) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 6) {
      modules[i][8] = mod;
    } else if (i < 8) {
      modules[i + 1][8] = mod;
    } else {
      modules[size - 15 + i][8] = mod;
    }
    modules[8][size - 1 - i] = mod;
  }
  modules[size - 8][8] = true;
}

function calculateTypeInfo(maskPattern) {
  const data = (ERROR_CORRECTION_LEVEL << 3) | maskPattern;
  return getBCHTypeInfo(data);
}

function applyMask(maskPattern, row, col) {
  switch (maskPattern) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function mapData(modules, reserved, data, maskPattern) {
  const size = modules.length;
  let byteIndex = 0;
  let bitIndex = 7;
  let upward = true;

  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) {
      c -= 1;
    }
    for (let i = 0; i < size; i += 1) {
      const r = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j += 1) {
        const currentCol = c - j;
        if (reserved[r][currentCol]) {
          continue;
        }
        let dark = false;
        if (byteIndex < data.length) {
          dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
        }
        if (applyMask(maskPattern, r, currentCol)) {
          dark = !dark;
        }
        modules[r][currentCol] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
    }
    upward = !upward;
  }
}

function cloneMatrix(matrix) {
  return matrix.map((row) => row.slice());
}

function calculatePenalty(modules) {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: consecutive modules
  for (let r = 0; r < size; r += 1) {
    penalty += calculateLinePenalty(modules[r]);
  }
  for (let c = 0; c < size; c += 1) {
    const column = [];
    for (let r = 0; r < size; r += 1) {
      column.push(modules[r][c]);
    }
    penalty += calculateLinePenalty(column);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (
        v === modules[r][c + 1] &&
        v === modules[r + 1][c] &&
        v === modules[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like patterns in rows and columns
  for (let r = 0; r < size; r += 1) {
    penalty += calculateFinderPatternPenalty(modules[r]);
  }
  for (let c = 0; c < size; c += 1) {
    const column = [];
    for (let r = 0; r < size; r += 1) {
      column.push(modules[r][c]);
    }
    penalty += calculateFinderPatternPenalty(column);
  }

  // Rule 4: proportion of dark modules
  let darkCount = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) {
        darkCount += 1;
      }
    }
  }
  const totalCount = size * size;
  const ratio = Math.abs((darkCount * 100) / totalCount - 50) / 5;
  penalty += Math.floor(ratio) * 10;

  return penalty;
}

function calculateLinePenalty(line) {
  let penalty = 0;
  let current = line[0];
  let length = 1;
  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === current) {
      length += 1;
    } else {
      if (length >= 5) {
        penalty += 3 + (length - 5);
      }
      current = line[i];
      length = 1;
    }
  }
  if (length >= 5) {
    penalty += 3 + (length - 5);
  }
  return penalty;
}

function calculateFinderPatternPenalty(line) {
  let penalty = 0;
  const pattern = [true, false, true, true, true, false, true];
  for (let i = 0; i <= line.length - pattern.length; i += 1) {
    let matches = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (line[i + j] !== pattern[j]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    const beforeWhite = i >= 4 && line.slice(i - 4, i).every((value) => !value);
    const afterWhite = i + pattern.length <= line.length - 4 &&
      line.slice(i + pattern.length, i + pattern.length + 4).every((value) => !value);
    if (beforeWhite || afterWhite) {
      penalty += 40;
    }
  }
  return penalty;
}

function buildMatrix(typeNumber, data) {
  const base = initializeModules(typeNumber);
  let bestModules = null;
  let bestPenalty = Infinity;
  let bestMask = 0;

  for (let mask = 0; mask < 8; mask += 1) {
    const trialModules = cloneMatrix(base.modules);
    mapData(trialModules, base.reserved, data, mask);
    setupTypeInfo(trialModules, mask);
    const penalty = calculatePenalty(trialModules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = trialModules;
    }
  }

  if (!bestModules) {
    throw new Error('failed to build QR matrix');
  }

  // Ensure final matrix carries the chosen mask pattern in format info
  setupTypeInfo(bestModules, bestMask);
  return bestModules;
}

function createQRCode(text) {
  const typeNumber = chooseTypeNumber(text);
  const dataBuffer = createDataBuffer(text, typeNumber);
  const rsBlocks = getRSBlocks(typeNumber);
  const data = createBytes(dataBuffer, rsBlocks);
  return buildMatrix(typeNumber, data);
}
function drawWith2dContext({ canvas, modules, size, background, foreground }) {
  const moduleCount = modules.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.resolve();
  }
  const dpr = wx.getWindowInfo
    ? wx.getWindowInfo().pixelRatio || 1
    : wx.getSystemInfoSync
      ? wx.getSystemInfoSync().pixelRatio || 1
      : 1;
  if (typeof canvas.width === 'number') {
    canvas.width = size * dpr;
  }
  if (typeof canvas.height === 'number') {
    canvas.height = size * dpr;
  }
  if (canvas.style) {
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = foreground;
  const scale = size / moduleCount;
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (modules[row][col]) {
        const x = Math.round(col * scale);
        const y = Math.round(row * scale);
        const w = Math.ceil((col + 1) * scale) - Math.floor(col * scale);
        const h = Math.ceil((row + 1) * scale) - Math.floor(row * scale);
        ctx.fillRect(x, y, w, h);
      }
    }
  }
  return Promise.resolve();
}

function drawWithLegacyContext({ canvasId, modules, size, background, foreground }, context) {
  const moduleCount = modules.length;
  const scale = size / moduleCount;
  const ctx = wx.createCanvasContext(canvasId, context);
  ctx.setFillStyle(background);
  ctx.fillRect(0, 0, size, size);
  ctx.setFillStyle(foreground);
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (modules[row][col]) {
        const w = Math.ceil((col + 1) * scale) - Math.floor(col * scale);
        const h = Math.ceil((row + 1) * scale) - Math.floor(row * scale);
        ctx.fillRect(Math.round(col * scale), Math.round(row * scale), w, h);
      }
    }
  }
  return new Promise((resolve) => {
    ctx.draw(false, () => {
      resolve();
    });
  });
}

export function drawQrCode(
  { text, size = 256, canvasId, background = '#ffffff', foreground = '#000000' },
  context
) {
  if (!canvasId) {
    throw new Error('canvasId is required');
  }
  if (!text) {
    return Promise.resolve();
  }
  const modules = createQRCode(text);

  const query = wx.createSelectorQuery ? wx.createSelectorQuery() : null;
  if (query) {
    if (context) {
      query.in(context);
    }
    return new Promise((resolve, reject) => {
      query
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          const target = res && res[0];
          if (target && target.node) {
            drawWith2dContext({
              canvas: target.node,
              modules,
              size: size || target.width || 256,
              background,
              foreground
            })
              .then(resolve)
              .catch(reject);
          } else {
            drawWithLegacyContext({ canvasId, modules, size, background, foreground }, context)
              .then(resolve)
              .catch(reject);
          }
        });
    });
  }

  return drawWithLegacyContext({ canvasId, modules, size, background, foreground }, context);
}

export default {
  drawQrCode
};
