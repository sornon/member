const CLOUD_ASSET_FILE_ID_BASE_PATH =
  'cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets';

function trimSlashes(value) {
  return `${value}`.replace(/(^\/+|\/+$)/g, '');
}

function joinPath(base, ...segments) {
  const safeBase = `${base}`.replace(/\/+$/g, '');
  const rest = segments
    .map((segment) => trimSlashes(segment))
    .filter(Boolean)
    .join('/');
  return rest ? `${safeBase}/${rest}` : safeBase;
}

function parseFileIdBase(base) {
  const normalized = `${base}`.trim();
  if (!normalized.startsWith('cloud://')) {
    return { envId: '', bucket: '', rootPath: trimSlashes(normalized) };
  }
  const withoutScheme = normalized.replace(/^cloud:\/\//, '');
  const dotIndex = withoutScheme.indexOf('.');
  if (dotIndex === -1) {
    return { envId: '', bucket: '', rootPath: '' };
  }
  const envId = withoutScheme.slice(0, dotIndex);
  const remainder = withoutScheme.slice(dotIndex + 1);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) {
    return { envId, bucket: trimSlashes(remainder), rootPath: '' };
  }
  const bucket = trimSlashes(remainder.slice(0, slashIndex));
  const rootPath = trimSlashes(remainder.slice(slashIndex + 1));
  return { envId, bucket, rootPath };
}

const { bucket: CLOUD_ASSET_BUCKET, rootPath: CLOUD_ASSET_ROOT_PATH } =
  parseFileIdBase(CLOUD_ASSET_FILE_ID_BASE_PATH);

const CLOUD_ASSET_CDN_BASE_PATH = CLOUD_ASSET_BUCKET
  ? joinPath(`https://${CLOUD_ASSET_BUCKET}.tcb.qcloud.la`, CLOUD_ASSET_ROOT_PATH)
  : '';

function buildCloudAssetFileId(...segments) {
  return joinPath(CLOUD_ASSET_FILE_ID_BASE_PATH, ...segments);
}

function buildCloudAssetCdnUrl(...segments) {
  if (!CLOUD_ASSET_CDN_BASE_PATH) {
    return buildCloudAssetFileId(...segments);
  }
  return joinPath(CLOUD_ASSET_CDN_BASE_PATH, ...segments);
}

const BACKGROUND_IMAGE_FILE_ID_BASE_PATH = buildCloudAssetFileId('background');
const CHARACTER_IMAGE_FILE_ID_BASE_PATH = buildCloudAssetFileId('character');

const BACKGROUND_IMAGE_BASE_PATH = buildCloudAssetCdnUrl('background');
const CHARACTER_IMAGE_BASE_PATH = buildCloudAssetCdnUrl('character');

module.exports = {
  CLOUD_ASSET_FILE_ID_BASE_PATH,
  CLOUD_ASSET_CDN_BASE_PATH,
  CLOUD_ASSET_BUCKET,
  CLOUD_ASSET_ROOT_PATH,
  BACKGROUND_IMAGE_FILE_ID_BASE_PATH,
  CHARACTER_IMAGE_FILE_ID_BASE_PATH,
  BACKGROUND_IMAGE_BASE_PATH,
  CHARACTER_IMAGE_BASE_PATH,
  buildCloudAssetFileId,
  buildCloudAssetCdnUrl
};
