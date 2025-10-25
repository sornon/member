const CLOUD_ASSET_BASE_PATH =
  'cloud://cloud1-8gyoxq651fcc92c2.636c-cloud1-8gyoxq651fcc92c2-1380371219/assets';

function buildCloudAssetUrl(...segments) {
  return [CLOUD_ASSET_BASE_PATH, ...segments]
    .map((segment) => `${segment}`.replace(/(^\/+|\/+$)/g, ''))
    .filter(Boolean)
    .join('/');
}

const AVATAR_IMAGE_BASE_PATH = buildCloudAssetUrl('avatar');
const AVATAR_FRAME_IMAGE_BASE_PATH = buildCloudAssetUrl('border');
const BACKGROUND_IMAGE_BASE_PATH = buildCloudAssetUrl('background');
const BACKGROUND_VIDEO_BASE_PATH = buildCloudAssetUrl('background');
const CHARACTER_IMAGE_BASE_PATH = buildCloudAssetUrl('character');
const TITLE_IMAGE_BASE_PATH = buildCloudAssetUrl('title');

module.exports = {
  CLOUD_ASSET_BASE_PATH,
  AVATAR_IMAGE_BASE_PATH,
  AVATAR_FRAME_IMAGE_BASE_PATH,
  BACKGROUND_IMAGE_BASE_PATH,
  BACKGROUND_VIDEO_BASE_PATH,
  CHARACTER_IMAGE_BASE_PATH,
  TITLE_IMAGE_BASE_PATH,
  buildCloudAssetUrl
};
