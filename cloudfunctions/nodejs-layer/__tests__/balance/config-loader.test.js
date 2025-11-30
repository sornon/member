const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getLevelCurveConfig,
  getPvpConfig,
  setBalanceVersion,
  __resetBalanceCache
} = require('balance/config-loader');

function writeConfig(dir, fileName, content) {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(content));
}

function createTempConfig(structure = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-config-'));
  Object.keys(structure).forEach((fileName) => {
    writeConfig(dir, fileName, structure[fileName]);
  });
  return dir;
}

describe('balance config loader', () => {
  const originalEnv = process.env.BALANCE_CONFIG_DIR;

  afterEach(() => {
    process.env.BALANCE_CONFIG_DIR = originalEnv;
    setBalanceVersion('v1');
    __resetBalanceCache();
  });

  test('falls back to defaults when files are missing', () => {
    process.env.BALANCE_CONFIG_DIR = path.join(os.tmpdir(), 'missing-balance-dir');
    __resetBalanceCache();
    const levelConfig = getLevelCurveConfig();
    expect(levelConfig.hitFormula.base).toBe(0.85);
    expect(levelConfig.penetration.max).toBeCloseTo(0.6);
  });

  test('loads versioned profile when available', () => {
    const dir = createTempConfig({
      'level-curves.json': {
        version: 'v1',
        profiles: {
          v1: { hitFormula: { base: 0.82 } },
          v2: { hitFormula: { base: 0.91, max: 0.97 } }
        }
      }
    });
    process.env.BALANCE_CONFIG_DIR = dir;
    setBalanceVersion('v2');
    __resetBalanceCache();
    const levelConfig = getLevelCurveConfig();
    expect(levelConfig.hitFormula.base).toBe(0.91);
    expect(levelConfig.hitFormula.max).toBe(0.97);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('uses defaults for missing fields while honoring provided overrides', () => {
    const dir = createTempConfig({
      'pvp-config.json': { profiles: { v1: { roundLimit: 12 } } }
    });
    process.env.BALANCE_CONFIG_DIR = dir;
    __resetBalanceCache();
    const pvpConfig = getPvpConfig();
    expect(pvpConfig.roundLimit).toBe(12);
    expect(pvpConfig.recentMatchLimit).toBe(10);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
