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

const RS_BLOCK_TABLE = [
  // L, M, Q, H
  [1, 26, 19],
  [1, 26, 16],
  [1, 26, 13],
  [1, 26, 9]
];

function getRSBlocks(typeNumber) {
  const rsBlock = RS_BLOCK_TABLE[1];
  const list = [];
  for (let i = 0; i < rsBlock.length / 3; i += 1) {
    const count = rsBlock[i * 3 + 0];
    const totalCount = rsBlock[i * 3 + 1];
    const dataCount = rsBlock[i * 3 + 2];
    for (let j = 0; j < count; j += 1) {
      list.push({ totalCount, dataCount });
    }
  }
  return list;
}

function createBytes(buffer, rsBlocks) {
  const offset = buffer.length;
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

function createDataBuffer(text) {
  const buffer = [];
  const codewords = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    codewords.push(code);
  }
  buffer.push(...codewords);
  buffer.push(0);
  while (buffer.length % 2 !== 0) {
    buffer.push(0);
  }
  return buffer;
}

function createModules(typeNumber, data) {
  const moduleCount = typeNumber * 4 + 17;
  const modules = new Array(moduleCount);
  for (let row = 0; row < moduleCount; row += 1) {
    modules[row] = new Array(moduleCount);
    for (let col = 0; col < moduleCount; col += 1) {
      modules[row][col] = null;
    }
  }

  setupPositionProbePattern(0, 0, modules);
  setupPositionProbePattern(moduleCount - 7, 0, modules);
  setupPositionProbePattern(0, moduleCount - 7, modules);
  setupTimingPattern(modules);

  const dataCache = data;
  let row = moduleCount - 1;
  let col = moduleCount - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  const direction = -1;
  while (row > 0) {
    if (row === 6) {
      row -= 1;
    }
    for (let c = 0; c < 2; c += 1) {
      const currentCol = col - c;
      if (modules[row][currentCol] === null) {
        let dark = false;
        if (byteIndex < dataCache.length) {
          dark = ((dataCache[byteIndex] >>> bitIndex) & 1) === 1;
        }
        const mask = (row + currentCol) % 2 === 0;
        modules[row][currentCol] = dark !== mask;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
    }
    col -= 2;
    if (col < 0) {
      col = moduleCount - 1;
      row += direction;
    }
  }
  return modules;
}

function setupPositionProbePattern(row, col, modules) {
  for (let r = -1; r <= 7; r += 1) {
    if (row + r <= -1 || modules.length <= row + r) continue;
    for (let c = -1; c <= 7; c += 1) {
      if (col + c <= -1 || modules.length <= col + c) continue;
      if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))) {
        modules[row + r][col + c] = true;
      } else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
        modules[row + r][col + c] = true;
      } else {
        modules[row + r][col + c] = false;
      }
    }
  }
}

function setupTimingPattern(modules) {
  for (let r = 8; r < modules.length - 8; r += 1) {
    if (modules[r][6] !== null) continue;
    modules[r][6] = r % 2 === 0;
  }
  for (let c = 8; c < modules.length - 8; c += 1) {
    if (modules[6][c] !== null) continue;
    modules[6][c] = c % 2 === 0;
  }
}

function calculateTypeInfo(maskPattern) {
  const data = (0 << 3) | maskPattern;
  const bits = getBCHTypeInfo(data);
  return bits;
}

function setupTypeInfo(modules, maskPattern) {
  const bits = calculateTypeInfo(maskPattern);
  for (let i = 0; i < 15; i += 1) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 6) {
      modules[i][8] = mod;
    } else if (i < 8) {
      modules[i + 1][8] = mod;
    } else {
      modules[modules.length - 15 + i][8] = mod;
    }
    modules[8][modules.length - 1 - i] = mod;
  }
  modules[modules.length - 8][8] = true;
}

function createQRCode(text) {
  const typeNumber = 4; // sufficient for short payloads
  const dataBuffer = createDataBuffer(text);
  const rsBlocks = getRSBlocks(typeNumber);
  const data = createBytes(dataBuffer, rsBlocks);
  const modules = createModules(typeNumber, data);
  setupTypeInfo(modules, 0);
  return modules;
}

function drawWith2dContext({ canvas, modules, size, background, foreground }) {
  const moduleCount = modules.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.resolve();
  }
  const dpr = wx.getSystemInfoSync ? wx.getSystemInfoSync().pixelRatio || 1 : 1;
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
