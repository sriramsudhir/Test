export default {
    data() {
        return {
            sortByType: 'desc',
            sortBy: 'created_at',
            page:  Number(this.$route.query.page) || 1,
            search: this.$route.query.q || null,
        }
    },
    methods: {
        resettingPage(){
            if(this.page !== 1){
                this.clearQuery()
                this.settingRoute()
            }
            this.$emit('fetching-data')
        },
        makeSearch() {
            if (this.$route.query.q !== this.search) {
                this.page = 1
                this.getDataWithRoute()
            }
        },
        clearQuery(){
            this.sortByType = 'desc'
            this.sortBy = 'created_at'
            this.page = 1
        },
        isDefaultPage(){
            return (this.sortByType === 'desc' && this.sortBy === 'created_at' && this.page === 1)
        },
        settingRoute() {
            if(this.isDefaultPage() && !this.search && this.resetRoute){
                this.$router.replace({query: {  }})
            }else if(this.isDefaultPage() && this.resetRoute){
                this.$router.replace({query: {q: this.search}})
            }else {
                this.$router.push({
                    query: {
                        ...this.$route.query,
                        orderby: this.sortBy,
                        orderbyType: this.sortByType,
                        page: this.page,
                        q: this.search,
                    }
                })
            }
        },
        dropdownSelected(isOrderType, data) {
            this.page = 1
            if (isOrderType)
                this.sortByType = data.key
            else
                this.sortBy = data.key

            this.getDataWithRoute()
        },
        getDataWithRoute() {
            this.settingRoute()
            this.$emit('fetching-data')
        },
        navigate(param) {
            if ((param > 0 && this.page >= this.pagination.lastPage) || (param < 0 && this.page <= 1))
                return

            this.page += param
            this.getDataWithRoute()
        },
        paginate(page) {
            if (this.page !== page) {
                this.page = page
                this.getDataWithRoute()
            }
        }
    }
}