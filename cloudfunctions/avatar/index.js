const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { COLLECTIONS } = require('common-config');

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'assets';

  switch (action) {
    case 'assets':
      return listAssets(OPENID);
    case 'save':
      return saveConfig(OPENID, event.config || {});
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

async function listAssets(openid) {
  const [categoriesSnapshot, assetsSnapshot, memberDoc] = await Promise.all([
    db.collection(COLLECTIONS.AVATAR_CATEGORIES).orderBy('order', 'asc').get(),
    db.collection(COLLECTIONS.AVATARS).where({ status: 'online' }).get(),
    db.collection(COLLECTIONS.MEMBERS).doc(openid).get().catch(() => null)
  ]);

  const categories = categoriesSnapshot.data || [];
  const assets = assetsSnapshot.data || [];
  const equipped = (memberDoc && memberDoc.data && memberDoc.data.avatarConfig) || {};

  const assetsByCategory = {};
  categories.forEach((category) => {
    assetsByCategory[category._id] = [];
  });
  assets.forEach((asset) => {
    const categoryAssets = assetsByCategory[asset.categoryId] || (assetsByCategory[asset.categoryId] = []);
    categoryAssets.push({
      _id: asset._id,
      name: asset.name,
      description: asset.description,
      unlockText: asset.unlockText || '会员解锁',
      image: asset.image || ''
    });
  });

  return {
    categories,
    assetsByCategory,
    equipped
  };
}

async function saveConfig(openid, config) {
  const members = db.collection(COLLECTIONS.MEMBERS);
  const doc = await members.doc(openid).get().catch(() => null);
  if (doc && doc.data) {
    await members.doc(openid).update({
      data: {
        avatarConfig: config,
        avatarUpdatedAt: new Date()
      }
    });
  } else {
    await members.add({
      data: {
        _id: openid,
        avatarConfig: config,
        createdAt: new Date()
      }
    });
  }
  return { success: true };
}
