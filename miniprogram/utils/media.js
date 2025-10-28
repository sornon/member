function resolveVideoPosterSource(url) {
  if (typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('cloud://')) {
    const withoutProtocol = trimmed.slice('cloud://'.length);
    const firstSlashIndex = withoutProtocol.indexOf('/');
    if (firstSlashIndex > 0) {
      const authority = withoutProtocol.slice(0, firstSlashIndex);
      const resourcePath = withoutProtocol.slice(firstSlashIndex + 1);
      const bucketSeparatorIndex = authority.indexOf('.');
      if (bucketSeparatorIndex > 0 && resourcePath) {
        const bucketId = authority.slice(bucketSeparatorIndex + 1);
        if (bucketId) {
          return `https://${bucketId}.tcb.qcloud.la/${resourcePath}`;
        }
      }
    }
  }

  return '';
}

module.exports = {
  resolveVideoPosterSource
};
