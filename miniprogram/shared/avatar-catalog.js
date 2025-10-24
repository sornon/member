const RAW_AVATARS = [
  { gender: 'male', rarity: 'c', index: 1 },
  { gender: 'male', rarity: 'c', index: 2 },
  { gender: 'male', rarity: 'c', index: 3 },
  { gender: 'male', rarity: 'b', index: 1 },
  { gender: 'male', rarity: 'b', index: 2 },
  { gender: 'male', rarity: 'b', index: 3 },
  { gender: 'male', rarity: 'b', index: 4 },
  { gender: 'male', rarity: 'b', index: 5 },
  { gender: 'male', rarity: 'b', index: 6 },
  { gender: 'male', rarity: 'a', index: 1 },
  { gender: 'male', rarity: 'a', index: 2 },
  { gender: 'female', rarity: 'c', index: 1 },
  { gender: 'female', rarity: 'c', index: 2 },
  { gender: 'female', rarity: 'c', index: 3 },
  { gender: 'female', rarity: 'b', index: 1 },
  { gender: 'female', rarity: 'b', index: 2 },
  { gender: 'female', rarity: 'b', index: 3 },
  { gender: 'female', rarity: 'b', index: 4 },
  { gender: 'female', rarity: 'b', index: 5 },
  { gender: 'female', rarity: 'b', index: 6 },
  { gender: 'female', rarity: 'a', index: 1 },
  { gender: 'female', rarity: 'a', index: 2 },
  { gender: 'female', rarity: 'sss', index: 1 }
];

function buildAvatarId({ gender, rarity, index }) {
  return `${gender}-${rarity}-${index}`;
}

const AVATAR_IDS = RAW_AVATARS.map((item) => buildAvatarId(item));

function listAvatarIds() {
  return AVATAR_IDS.slice();
}

module.exports = {
  RAW_AVATARS,
  buildAvatarId,
  listAvatarIds
};
