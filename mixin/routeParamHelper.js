export default {
  data() {
    return {
      orderByType: '',
      orderBy: '',
      page: 0,
      search: null
    }
  },
  methods: {
    settingParam(data) {
      this.orderByType = data?.orderByType || 'desc'
      this.orderBy = data?.orderBy || 'created_at'
      this.page = Number(data?.page) || 1
      this.search = data?.q || null
    },
    settingRouteParam() {
      this.orderByType = this.$route.query.orderByType || 'desc'
      this.orderBy = this.$route.query.orderBy || 'created_at'
      this.page = Number(this.$route.query.page) || 1
      this.search = this.$route.query.q || null
    }
  }
}
