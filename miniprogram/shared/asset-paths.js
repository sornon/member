const CLOUD_ASSET_BASE_PATH =
  'cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets';

const LEGACY_ASSET_BASE_PATH = '/assets';

function buildCloudAssetUrl(...segments) {
  return [CLOUD_ASSET_BASE_PATH, ...segments]
    .map((segment) => `${segment}`.replace(/(^\/+|\/+$)/g, ''))
    .filter(Boolean)
    .join('/');
}

const BACKGROUND_IMAGE_BASE_PATH = buildCloudAssetUrl('background');
const CHARACTER_IMAGE_BASE_PATH = buildCloudAssetUrl('character');
const AVATAR_IMAGE_BASE_PATH = buildCloudAssetUrl('avatar');
const AVATAR_FRAME_BASE_PATH = buildCloudAssetUrl('border');

module.exports = {
  CLOUD_ASSET_BASE_PATH,
  LEGACY_ASSET_BASE_PATH,
  BACKGROUND_IMAGE_BASE_PATH,
  CHARACTER_IMAGE_BASE_PATH,
  AVATAR_IMAGE_BASE_PATH,
  AVATAR_FRAME_BASE_PATH,
  buildCloudAssetUrl
};
