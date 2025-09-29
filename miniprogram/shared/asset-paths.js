const CLOUD_ASSET_BASE_PATH =
  'cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets';

function buildCloudAssetUrl(...segments) {
  return [CLOUD_ASSET_BASE_PATH, ...segments]
    .map((segment) => `${segment}`.replace(/(^\/+|\/+$)/g, ''))
    .filter(Boolean)
    .join('/');
}

const BACKGROUND_IMAGE_BASE_PATH = buildCloudAssetUrl('background');
const LOCAL_BACKGROUND_IMAGE_BASE_PATH = '/assets/background';
const CHARACTER_IMAGE_BASE_PATH = buildCloudAssetUrl('character');

module.exports = {
  CLOUD_ASSET_BASE_PATH,
  BACKGROUND_IMAGE_BASE_PATH,
  LOCAL_BACKGROUND_IMAGE_BASE_PATH,
  CHARACTER_IMAGE_BASE_PATH,
  buildCloudAssetUrl
};
