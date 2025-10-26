Component({
  properties: {
    name: {
      type: String,
      value: ''
    },
    showBadge: {
      type: Boolean,
      value: false
    },
    titleImage: {
      type: String,
      value: ''
    },
    titleLabel: {
      type: String,
      value: ''
    }
  },
  methods: {
    handleNameTap() {
      this.triggerEvent('nametap');
    },
    handleTitleTap() {
      this.triggerEvent('titletap');
    }
  }
});
