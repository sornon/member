export const menuData = {
  sections: [
    { id: 'drinks', title: '酒水', categories: [], items: [] },
    { id: 'dining', title: '用餐', categories: [], items: [] }
  ],
  categories: [],
  items: [],
  softDrinks: [],
  diningCategories: [],
  diningItems: [],
  generatedAt: ''
};

export const categories = menuData.categories;
export const items = menuData.items;
export const softDrinks = menuData.softDrinks;
export const diningCategories = menuData.diningCategories || [];
export const diningItems = menuData.diningItems || [];
export default menuData;
