const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  try {
    console.log('[wallet-pay-notify] payment notify event', JSON.stringify(event || {}));
  } catch (error) {
    console.error('[wallet-pay-notify] failed to stringify event', error);
  }
  return {
    errCode: 0,
    errMsg: 'OK'
  };
};
