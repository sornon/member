const LOCAL_CONFIG = {
  startupVideo: {
    /**
     * 是否启用开屏视频。
     * 设置为 false 可以直接关闭开屏视频相关的逻辑。
     */
    enabled: false,
    /**
     * 开屏视频在云存储中的相对地址，例如："background/cover-20251028.mp4"。
     * 为空时会回退到内置的默认视频列表。
     */
    cloudRelativePath: ''
  }
};

function normalizeStartupVideoConfig(source) {
  const config = source && typeof source === 'object' ? source : {};
  const enabled = config.enabled === false ? false : true;
  const cloudRelativePath = config.cloudRelativePath && typeof config.cloudRelativePath === 'string'
    ? config.cloudRelativePath.trim()
    : '';
  return { enabled, cloudRelativePath };
}

function getStartupVideoConfig() {
  return normalizeStartupVideoConfig(LOCAL_CONFIG.startupVideo);
}

module.exports = {
  LOCAL_CONFIG,
  getStartupVideoConfig
};
